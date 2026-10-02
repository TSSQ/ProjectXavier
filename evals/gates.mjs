/**
 * Pure(ish) gate/scoring helpers for `evals/run-eval.mjs` (dev tooling —
 * never ships). Extracted out of `run-eval.mjs` so they're independently
 * unit-testable via `evals/test-gates.mjs` without having to shell out to
 * the real dataset/engine runner — `run-eval.mjs` itself is still the only
 * place that wires these together with real I/O (reading
 * `evals/thresholds.json`, running the engine, writing the artifact).
 *
 * `isRepoDirty`'s pathspec lives here too: it was missing
 * `src/lib`, `src/features/ai`, and `package-lock.json` — all of which can
 * change an engine's real output (the BYOK transports live under
 * `src/features/ai`, shared normalize/guard helpers under `src/lib`, and a
 * dependency bump can change `zodSchema()`'s behaviour) without the artifact
 * being marked `dirty`.
 */
import { execFileSync } from 'node:child_process';
import { scoreCase, aggregate } from './score.mjs';

/** `n == null ? 'n/a' : "NN.N%"`. */
export function pct(n) {
  return n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
}

/** Whether one case counts as "passing" for baseline/regression purposes —
 *  a fail-to-parse case (`expected: null`) passes iff the engine returned
 *  `null`; any other case passes iff every scored field matches. An `error`
 *  status never counts as passing (a harness fault must never be scored as
 *  a pass in EITHER population). */
export function casePassed(caseObj, result) {
  if (!result || result.status === 'error') return false;
  const scored = scoreCase(caseObj.expected ?? null, result.parse ?? null);
  return scored.failToParseCase ? scored.correct : scored.overall;
}

/** Compact expected-vs-actual value for one scored field — mirrors the exact
 *  comparison `scoreCase` (score.mjs) makes, so a diagnostic's `actual` is
 *  exactly what was compared, not a re-derivation. */
function fieldDiffValue(field, expected, parse) {
  switch (field) {
    case 'amountMinor':
      return { expected: expected.amountMinor, actual: parse?.amount ?? null };
    case 'sign':
      return { expected: expected.sign, actual: parse?.type ?? null };
    case 'dateISO':
      return {
        expected: expected.dateISO,
        actual: parse?.occurredAt != null ? new Date(parse.occurredAt).toISOString().slice(0, 10) : null,
      };
    case 'category':
      return { expected: expected.category, actual: parse?.category ?? null };
    case 'payee':
      return { expected: expected.payee, actual: parse?.payee ?? null };
    default:
      return { expected: null, actual: null };
  }
}

/** Compact wrong-field diff for one (case, sample result) pair — `[]` when
 *  the sample scored correct. A total miss (no parse against a real label,
 *  or an unwanted parse against a fail-to-parse label) is reported as one
 *  `field: 'parse'` entry rather than every OBJECTIVE field individually,
 *  since the real problem is "no/an unwanted parse", not any one field. */
export function diffCase(caseObj, result) {
  const expected = caseObj.expected ?? null;
  if (!result || result.status === 'error') {
    // `error` included — a harness fault's own reason belongs right next
    // to the diff entry that reports it, not only in the engine report's
    // separate top-level `errors` list.
    return [
      { field: 'status', expected: 'ok', actual: result?.status ?? 'missing', error: result?.error ?? null },
    ];
  }
  const parse = result.parse ?? null;
  if (expected === null) {
    if (parse === null) return [];
    return [
      {
        field: 'parse',
        expected: null,
        actual: { amount: parse.amount, type: parse.type, category: parse.category, payee: parse.payee },
      },
    ];
  }
  if (parse === null) {
    return [
      {
        field: 'parse',
        expected: { amountMinor: expected.amountMinor, sign: expected.sign, dateISO: expected.dateISO },
        actual: null,
      },
    ];
  }
  const scored = scoreCase(expected, parse);
  return Object.keys(scored.fields)
    .filter((f) => !scored.fields[f])
    .map((f) => ({ field: f, ...fieldDiffValue(f, expected, parse) }));
}

/** Per-case diagnostics for the committed artifact: for every dataset case,
 *  its axis and how many of the N sample runs passed, plus — only for a case
 *  with at least one failing sample — a compact, deduplicated list of which
 *  asserted fields were wrong (expected vs actual) across those failing
 *  samples. `runs` is an array of N `runEngine()` results (length 1 for a
 *  single-sample run).
 *
 *  Cold-vs-warm and schema-order diagnostics: the `fm` engine's results
 *  carry a per-call `diagnostics` object (`{ attempts, threw,
 *  firstAttemptUseful, fieldOrders, attemptsDetail, orderUnavailable }` —
 *  see run_node.mjs's `runFM`). When present, `attemptsPerRun`/
 *  `firstAttemptUsefulPerRun` record it for EVERY case (cold-start
 *  accounting isn't only interesting on a failure), and `orderUnavailable`
 *  sums, across every sample, how many attempts logged no extractable
 *  schema property order at all.
 *
 *  `attemptsPerRun`/`firstAttemptUsefulPerRun`/`sampleDiagnostics` all skip
 *  a sample that has no `diagnostics` at all (e.g. a harness error), so
 *  their array position does NOT necessarily match the sample's index in
 *  `runs` — each entry therefore carries its own explicit `sample` (the
 *  0-based index into `runs`) rather than relying on position.
 *
 *  `sampleDiagnostics` — only for a case with at least one failing sample —
 *  is ONE ENTRY PER SAMPLE (not deduplicated/merged across samples, unlike
 *  the rest of this function): `{ sample, passed, attempts, wrongFields? }`,
 *  where `attempts` is that sample's own `attemptsDetail`
 *  (`[{ order, useful }]`, one per probe invocation within that sample).
 *  This is what actually ties a specific schema property order to a
 *  specific sample's pass/fail outcome — a case-wide deduplicated order SET
 *  (the previous `fieldOrdersObserved` shape) can't answer "did THIS order
 *  pass or fail", only "which orders occurred somewhere in this case's
 *  samples". Gated the same way `wrongFields` is (only cases with >=1
 *  failing sample) to keep the artifact reasonably sized — a case that
 *  passed every sample regardless of order isn't an order-correlation
 *  candidate worth the extra bytes. */
export function buildCaseDiagnostics(cases, runs) {
  return cases.map((c) => {
    let passes = 0;
    const seen = new Set();
    const wrongFields = [];
    const attemptsPerRun = [];
    const firstAttemptUsefulPerRun = [];
    const sampleDiagnostics = [];
    let hasColdStartDiagnostics = false;
    let orderUnavailable = 0;
    runs.forEach((run, sample) => {
      const r = run.find((x) => x.id === c.id);
      const samplePassed = casePassed(c, r);
      const sampleWrongFields = samplePassed ? [] : diffCase(c, r);

      if (samplePassed) {
        passes += 1;
      } else {
        for (const d of sampleWrongFields) {
          const key = JSON.stringify(d);
          if (seen.has(key)) continue;
          seen.add(key);
          wrongFields.push(d);
        }
      }

      if (r?.diagnostics) {
        hasColdStartDiagnostics = true;
        attemptsPerRun.push({ sample, attempts: r.diagnostics.attempts });
        firstAttemptUsefulPerRun.push({ sample, firstAttemptUseful: r.diagnostics.firstAttemptUseful });
        orderUnavailable += r.diagnostics.orderUnavailable ?? 0;
        sampleDiagnostics.push({
          sample,
          passed: samplePassed,
          attempts: r.diagnostics.attemptsDetail ?? [],
          ...(sampleWrongFields.length ? { wrongFields: sampleWrongFields } : {}),
        });
      }
    });
    return {
      id: c.id,
      axis: c.axis,
      passes,
      samples: runs.length,
      ...(hasColdStartDiagnostics ? { attemptsPerRun, firstAttemptUsefulPerRun } : {}),
      ...(orderUnavailable ? { orderUnavailable } : {}),
      ...(wrongFields.length ? { wrongFields } : {}),
      ...(wrongFields.length && hasColdStartDiagnostics ? { sampleDiagnostics } : {}),
    };
  });
}

/** Sums `orderUnavailable` across every case's diagnostics — the RUN-level
 *  count of probe attempts where `debugDescription`'s
 *  `"x-order"` couldn't be extracted at all. `caseDiagnostics` is
 *  `buildCaseDiagnostics`'s own return value (a case only carries
 *  `orderUnavailable` when it's non-zero, so this sums whatever is present,
 *  treating an absent field as 0). */
export function sumOrderUnavailable(caseDiagnostics) {
  return caseDiagnostics.reduce((sum, c) => sum + (c.orderUnavailable ?? 0), 0);
}

/** Per-case pass-rate across N repeated runs of a nondeterministic (model
 *  tier) engine — `runs` is an array of N `runEngine()` results, each the
 *  full per-case array for one full pass over the dataset. Returns
 *  `Map<caseId, { passes, total, passRate }>`. */
export function computePassRates(cases, runs) {
  const rates = new Map();
  for (const c of cases) {
    let passes = 0;
    for (const run of runs) {
      const r = run.find((x) => x.id === c.id);
      if (casePassed(c, r)) passes += 1;
    }
    rates.set(c.id, { passes, total: runs.length, passRate: passes / runs.length });
  }
  return rates;
}

/** Same "parse cases" (label asserts a real expense) vs "refusal cases"
 *  (`expected == null` — the refusal-case definition used everywhere, not
 *  the dataset's `axis` label) split as `score.mjs`'s `parseAccuracy`/
 *  `failToParseAccuracy`, but over pass-rate reliability — a case counts iff
 *  its pass-rate clears `perCaseThreshold` (boundary-inclusive, `>=`: e.g.
 *  3/5 = 0.6 passes a 0.6 threshold). An EMPTY population's `rate` is `null`
 *  (n/a), never `0` — the caller (`gateAgainstThresholdsNRuns`) must treat
 *  that as "not gated", not as a failure: `null ?? 0` would otherwise read
 *  as "0% reliable" and spuriously FAIL a dataset with no refusal cases. */
export function splitParseRefusalReliability(cases, passRates, perCaseThreshold) {
  const groups = { parseCases: { reliable: 0, total: 0 }, refusalCases: { reliable: 0, total: 0 } };
  for (const c of cases) {
    const key = c.expected == null ? 'refusalCases' : 'parseCases';
    groups[key].total += 1;
    if (passRates.get(c.id).passRate >= perCaseThreshold) groups[key].reliable += 1;
  }
  for (const g of Object.values(groups)) g.rate = g.total ? g.reliable / g.total : null;
  return groups;
}

/** Gate a model-tier engine run repeated N times: a case counts as
 *  "reliable" iff its pass-rate clears `thresholds.model.perCase`
 *  (boundary-inclusive, `>=`). The run passes only when BOTH populations
 *  clear their OWN bar separately — the fraction of RELIABLE parse cases
 *  must clear `thresholds.model.parse`, and the fraction of RELIABLE
 *  refusal cases must clear `thresholds.model.refusal`. An EMPTY population
 *  is reported "not gated" (n/a) rather than a spurious FAIL — there is
 *  nothing to be reliable (or unreliable) about. */
export function gateAgainstThresholdsNRuns(cases, passRates, thresholds, io = console) {
  const reliable = cases.filter((c) => passRates.get(c.id).passRate >= thresholds.model.perCase);
  const overall = cases.length ? reliable.length / cases.length : 0;
  const split = splitParseRefusalReliability(cases, passRates, thresholds.model.perCase);
  io.log(
    `\nReliable cases (pass-rate >= ${pct(thresholds.model.perCase)}): ${reliable.length}/${cases.length} (${pct(overall)})`
  );
  io.log(
    `  Parse cases:   ${split.parseCases.reliable}/${split.parseCases.total} (${pct(split.parseCases.rate)})\n` +
      `  Refusal cases: ${split.refusalCases.reliable}/${split.refusalCases.total} (${pct(split.refusalCases.rate)})`
  );

  let passed = true;
  if (split.parseCases.total === 0) {
    io.log('\nparse-case population empty — not gated (n/a).');
  } else if (split.parseCases.rate < thresholds.model.parse) {
    io.error(
      `\nFAIL: parse-case reliability ${pct(split.parseCases.rate)} is below the ${pct(thresholds.model.parse)} threshold.`
    );
    passed = false;
  }
  if (split.refusalCases.total === 0) {
    io.log('\nrefusal-case population empty — not gated (n/a).');
  } else if (split.refusalCases.rate < thresholds.model.refusal) {
    io.error(
      `\nFAIL: refusal-case reliability ${pct(split.refusalCases.rate)} is below the ${pct(thresholds.model.refusal)} threshold.`
    );
    passed = false;
  }
  if (passed) {
    io.log(
      `\nPASS — parse ${pct(split.parseCases.rate)} >= ${pct(thresholds.model.parse)} (or n/a), ` +
        `refusal ${pct(split.refusalCases.rate)} >= ${pct(thresholds.model.refusal)} (or n/a).`
    );
  }
  return { passed, reliable: reliable.length, total: cases.length, overall, parseRefusalSplit: split };
}

/** Gates a single-sample model-tier run on parse-case and refusal-case
 *  accuracy SEPARATELY. An EMPTY population
 *  (`report.counts.parseTotal`/`failToParseTotal === 0`) is reported "not
 *  gated" (n/a) rather than a spurious FAIL — `report.parseAccuracy`/
 *  `failToParseAccuracy` are already `null` in that case (see score.mjs's
 *  `aggregate`), and this must NOT coerce that `null` into `0` before
 *  comparing against the threshold, which previously always failed an empty
 *  population instead of skipping it. */
export function gateAgainstThresholds(report, thresholds, io = console) {
  const parseAcc = report.parseAccuracy;
  const refusalAcc = report.failToParseAccuracy;
  const parseTotal = report.counts?.parseTotal ?? 0;
  const refusalTotal = report.counts?.failToParseTotal ?? 0;
  let passed = true;
  if (parseTotal === 0) {
    io.log('\nparse-case population empty — not gated (n/a).');
  } else if (parseAcc < thresholds.model.parse) {
    io.error(
      `\nFAIL: parse-case accuracy ${pct(parseAcc)} is below the ${pct(thresholds.model.parse)} threshold.`
    );
    passed = false;
  }
  if (refusalTotal === 0) {
    io.log('\nrefusal-case population empty — not gated (n/a).');
  } else if (refusalAcc < thresholds.model.refusal) {
    io.error(
      `\nFAIL: refusal-case accuracy ${pct(refusalAcc)} is below the ${pct(thresholds.model.refusal)} threshold.`
    );
    passed = false;
  }
  if (passed) {
    io.log(
      `\nPASS — parse ${pct(parseAcc)} >= ${pct(thresholds.model.parse)} (or n/a), ` +
        `refusal ${pct(refusalAcc)} >= ${pct(thresholds.model.refusal)} (or n/a).`
    );
  }
  return passed;
}

/** Splits the heuristic gate does not apply to. holdout2 is N/A: seeding a
 *  baseline for it would itself be a (paid-in-integrity) holdout look, and the
 *  heuristic is not a candidate engine. */
export const BASELINE_NA_SPLITS = new Set(['holdout2']);

/** Review M5 — gates a heuristic run against `evals/baseline.json`, FILTERED
 *  to the SAME split as the current run, before comparing. `baseline` is the
 *  parsed `baseline.json` object; it carries a `bySplit` section (`{ dev:
 *  {...}, holdout: {...}, all: {...} }`, each shaped like the baseline used
 *  to be) computed once at seed time directly from a full run, split purely
 *  by each case's own `split` field — never recomputed here. Without this,
 *  comparing a `--split=dev` run's `passingCaseIds` against the ALL-case
 *  baseline's `passingCaseIds` falsely reports every baseline-passing
 *  HOLDOUT case as a "regression" (they're simply outside this run's case
 *  set) — 16 false regressions on this dataset's dev split before this fix.
 *  `cases` (the already split-filtered case list) is also used to intersect
 *  the chosen baseline slice's `passingCaseIds`, as a defense-in-depth
 *  belt-and-suspenders check — B2's append-only split assignment means this
 *  intersection should already be a no-op, but a gate must never trust that
 *  invariant blindly. Falls back to the top-level (legacy, pre-`bySplit`)
 *  baseline fields ONLY when `bySplit` is absent entirely, so an older
 *  `baseline.json` doesn't hard-crash the gate; when `bySplit` exists but has
 *  no slice for the requested split this THROWS ("no baseline for split X —
 *  seed it or mark N/A") rather than gate against the dev numbers. A split in
 *  `BASELINE_NA_SPLITS` (holdout2) is reported N/A and not gated. Pure apart from `io` (console by default,
 *  swappable in tests) — no file I/O of its own, unlike `run-eval.mjs`'s
 *  thin `gateAgainstBaseline` wrapper that reads `baseline.json` and calls
 *  this. `baselineLabel` (default `'evals/baseline.json'`) is purely for the
 *  printed message. */
export function gateAgainstBaselineReport(
  cases,
  resultsById,
  report,
  datasetSplit,
  baseline,
  io = console,
  { baselineLabel = 'evals/baseline.json' } = {}
) {
  // Splits whose heuristic gate is deliberately N/A: reported, never gated.
  if (BASELINE_NA_SPLITS.has(datasetSplit)) {
    io.log(
      `\nN/A — the heuristic gate is not applied to split=${datasetSplit} (reported, not gated; ` +
        `scoring it against a baseline would need a deliberate holdout look to seed).`
    );
    return true;
  }
  let splitBaseline = baseline;
  if (baseline.bySplit !== undefined) {
    // `bySplit` is present, so a missing slice is a real gap — never fall
    // back to the top-level (dev) numbers, which would silently gate this
    // split against another split's baseline.
    splitBaseline = baseline.bySplit[datasetSplit];
    if (splitBaseline == null) {
      throw new Error(`no baseline for split ${datasetSplit} — seed it or mark N/A (see BASELINE_NA_SPLITS in evals/gates.mjs)`);
    }
  }
  const caseIds = new Set(cases.map((c) => c.id));
  const baselinePassingIds = (splitBaseline.passingCaseIds ?? []).filter((id) => caseIds.has(id));

  const currentPassing = new Set(cases.filter((c) => casePassed(c, resultsById.get(c.id))).map((c) => c.id));

  let failed = false;
  const overall = report.overallAccuracy ?? 0;
  if (splitBaseline.overallAccuracy != null && overall < splitBaseline.overallAccuracy) {
    io.error(
      `\nFAIL: heuristic overall accuracy ${pct(overall)} (split=${datasetSplit}) dropped below baseline ${pct(splitBaseline.overallAccuracy)}.`
    );
    failed = true;
  }

  const regressed = baselinePassingIds.filter((id) => !currentPassing.has(id));
  if (regressed.length > 0) {
    io.error(`\nFAIL: ${regressed.length} case(s) passing at baseline (split=${datasetSplit}) now fail:`);
    for (const id of regressed) io.error(`  ${id}`);
    failed = true;
  }

  if (failed) {
    io.error(
      `\nBaseline: ${baselineLabel} (bySplit.${datasetSplit}) — update it deliberately if this regression is` +
        ` expected (e.g. a hand-labeled dataset fix), never to silence a real one.`
    );
    return false;
  }
  io.log(`\nPASS — at or above baseline (split=${datasetSplit}, ${pct(splitBaseline.overallAccuracy)}), no case regressed.`);
  return true;
}

// ─── M3 — restructured targets: ledgerCorrect, per-class recall, strata ────

/** Axis groups for the "good enough" bar's grouped-strata floors
 *  (evals/README.md's "Good enough bar" section, step 1b.1 M3) — each
 *  stratum's accuracy is reported on its own designated TARGET field,
 *  restricted to the cases in that stratum. `axes: null` means "every case"
 *  (filtered only by whether the target field applies at all, via
 *  `fieldValueForCase` below) rather than a dataset-axis subset. */
export const STRATA = {
  'amount-hard': {
    axes: ['amount-format', 'eu-decimal', 'currency-word-vs-symbol', 'large-amount'],
    field: 'amountMinor',
  },
  'sign-hard': { axes: ['income', 'refund', 'transfer', 'sign'], field: 'sign' },
  category: { axes: null, field: 'category' },
  payee: { axes: null, field: 'payee' },
  refusal: { axes: ['fail-to-parse'], field: 'refusal' },
};

/** Whether ONE case's result was correct on ONE field — `null` when the
 *  field doesn't apply to this case at all (e.g. `amountMinor` on a
 *  refusal case, or `category` on a case whose label leaves it unasserted),
 *  so the caller can exclude it from both numerator and denominator rather
 *  than counting it as a miss. `field === 'refusal'` is special: it only
 *  applies to fail-to-parse cases (`expected == null`) and asks "did the
 *  engine correctly return null". Every other field only applies to PARSE
 *  cases (`expected != null`), mirroring `scoreCase`'s own objective/
 *  optional-field rules (an `error` status always counts as a miss, never
 *  excluded, for a field that does apply). */
export function fieldValueForCase(caseObj, result, field) {
  if (field === 'refusal') {
    if (caseObj.expected != null) return null;
    if (!result || result.status === 'error') return false;
    return scoreCase(null, result.parse ?? null).correct;
  }
  if (caseObj.expected == null) return null;
  if (!result || result.status === 'error') {
    if (field === 'amountMinor' || field === 'sign' || field === 'dateISO') return false;
    if (caseObj.expected[field] != null) return false;
    return null;
  }
  const scored = scoreCase(caseObj.expected, result.parse ?? null);
  if (!(field in scored.fields)) return null;
  return scored.fields[field];
}

/** `{ correct, total, rate }` for one field, over the cases in `cases`
 *  optionally restricted to `axes` (an array of dataset axis names, or
 *  `null` for "every case the field applies to"). `rate` is `null` (n/a),
 *  never `0`, for an empty population. */
export function computeFieldAccuracy(cases, resultsById, axes, field) {
  let correct = 0;
  let total = 0;
  for (const c of cases) {
    if (axes && !axes.includes(c.axis)) continue;
    const v = fieldValueForCase(c, resultsById.get(c.id), field);
    if (v == null) continue;
    total += 1;
    if (v) correct += 1;
  }
  return { correct, total, rate: total ? correct / total : null };
}

/** All of `STRATA`'s grouped-strata floors, each `{ field, correct, total,
 *  rate }`. */
export function computeAllStrata(cases, resultsById) {
  return Object.fromEntries(
    Object.entries(STRATA).map(([name, { axes, field }]) => [
      name,
      { field, ...computeFieldAccuracy(cases, resultsById, axes, field) },
    ])
  );
}

/** Also report each individual dataset AXIS (not just the grouped strata
 *  above) on its own most-relevant target field — review nit "report each
 *  axis on its target field as well as overall". `AXIS_TARGET_FIELD` names,
 *  for every axis in the 150-case dataset, which single field is the
 *  diagnostic one to watch (the field the axis was specifically built to
 *  stress — see evals/README.md's "New axes" section); an axis not listed
 *  falls back to `amountMinor` (every parse case asserts it) and
 *  `fail-to-parse` falls back to `'refusal'`. */
export const AXIS_TARGET_FIELD = {
  plain: 'amountMinor',
  'payee-bearing': 'payee',
  'relative-date': 'dateISO',
  'absolute-date': 'dateISO',
  income: 'sign',
  refund: 'sign',
  'large-amount': 'amountMinor',
  'eu-decimal': 'amountMinor',
  'currency-word-vs-symbol': 'amountMinor',
  'multi-word-category': 'category',
  ambiguous: 'amountMinor',
  transfer: 'sign',
  'fail-to-parse': 'refusal',
  terse: 'amountMinor',
  sign: 'sign',
  'amount-format': 'amountMinor',
  'custom-vocab': 'category',
};

/** `{ [axis]: { field, correct, total, rate } }` for every axis present in
 *  `cases`, each on its own `AXIS_TARGET_FIELD` entry. */
export function computeAxisTargetFieldAccuracy(cases, resultsById) {
  const axes = [...new Set(cases.map((c) => c.axis))].sort();
  return Object.fromEntries(
    axes.map((axis) => {
      const field = AXIS_TARGET_FIELD[axis] ?? 'amountMinor';
      return [axis, { field, ...computeFieldAccuracy(cases, resultsById, [axis], field) }];
    })
  );
}

/** Primary target (evals/README.md's "Good enough" bar, step 1b.1 M3):
 *  `ledgerCorrect` — `amountMinor` AND `sign` AND `dateISO` all correct,
 *  i.e. the three fields that actually write ledger data unattended. Scored
 *  over PARSE cases only (`expected != null`) — a refusal case has no
 *  ledger entry to be correct or wrong about. */
export function computeLedgerCorrect(cases, resultsById) {
  let correct = 0;
  let total = 0;
  for (const c of cases) {
    if (c.expected == null) continue;
    total += 1;
    const r = resultsById.get(c.id);
    if (!r || r.status === 'error') continue;
    const scored = scoreCase(c.expected, r.parse ?? null);
    if (scored.fields.amountMinor && scored.fields.sign && scored.fields.dateISO) correct += 1;
  }
  return { correct, total, rate: total ? correct / total : null };
}

/** Per-class RECALL for the `sign` field: among cases whose label asserts
 *  `sign === signClass`, the fraction the engine also classified as
 *  `signClass`. The overall `sign` field accuracy (fieldAccuracy.sign) can
 *  stay high while one minority class's recall is much lower — ~76% of this
 *  dataset's parse cases are expense, so a model that's merely good at
 *  "expense" can still look good on the blended `sign` number while missing
 *  income/transfer specifically (review M3 — "the overall sign figure hides
 *  income recall of 84%"). */
export function computeClassRecall(cases, resultsById, signClass) {
  let correct = 0;
  let total = 0;
  for (const c of cases) {
    if (c.expected?.sign !== signClass) continue;
    total += 1;
    const r = resultsById.get(c.id);
    if (!r || r.status === 'error') continue;
    const scored = scoreCase(c.expected, r.parse ?? null);
    if (scored.fields.sign) correct += 1;
  }
  return { correct, total, rate: total ? correct / total : null };
}

/** Per-refusal-SUBTYPE breakdown (step 1b.1 QA/review fix round — review
 *  Major 2): previously this table (README's "Per refusal subtype" section,
 *  M8) was worked out BY HAND from a committed artifact's per-case data —
 *  never recomputed by code, so it could silently drift from the artifact
 *  it claimed to summarize. Scored the same way `fieldValueForCase`'s
 *  `'refusal'` field is (correct iff a `fail-to-parse` case's engine result
 *  returned `null`), grouped by each case's own `subtype` (fail-to-parse
 *  cases only — see evals/README.md's "Refusal coverage" section); a case
 *  with no `subtype` at all (shouldn't happen for a fail-to-parse case in
 *  the current dataset, but a reader relabeling/adding one without a
 *  subtype must not silently vanish from every bucket) is grouped under
 *  `'unspecified'` rather than dropped. */
export function computeRefusalSubtypeBreakdown(cases, resultsById) {
  const bySubtype = new Map();
  for (const c of cases) {
    if (c.expected != null) continue;
    const key = c.subtype ?? 'unspecified';
    const entry = bySubtype.get(key) ?? { correct: 0, total: 0 };
    entry.total += 1;
    if (fieldValueForCase(c, resultsById.get(c.id), 'refusal')) entry.correct += 1;
    bySubtype.set(key, entry);
  }
  return Object.fromEntries(
    [...bySubtype.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([subtype, { correct, total }]) => [subtype, { correct, total, rate: total ? correct / total : null }])
  );
}

/** Non-gating "refusal after intent routing" figure (step 1b.1 QA/review fix
 *  round — review Major 3). The real app runs `detectIntent`
 *  (`src/domain/intentGate.ts`) BEFORE the parser ever sees a message —
 *  some of this dataset's refusal (`fail-to-parse`) cases are
 *  query/account/tx-op shaped and get routed to a different handler
 *  entirely, so whatever a parser engine under test would have returned for
 *  that case is moot in production: it never reaches the parser to matter.
 *
 *  `routedIds` is a `Set<string>` of case ids the real `detectIntent` routes
 *  away — computed by the CALLER (this module is plain JS; `detectIntent`
 *  is TypeScript, so the real routing decision has to come from a `tsx`
 *  subprocess, same reason `runEngine` shells out in run-eval.mjs — see
 *  that file's `getRoutedIds`), never re-derived here, so this function
 *  stays pure and independently testable with a synthetic `routedIds` set.
 *  A routed case is EXCLUDED from both the numerator and denominator of the
 *  reported rate (not force-counted as correct) — the real app never asked
 *  the parser at all, so the raw engine result for that case isn't evidence
 *  of anything either way. Scored only over refusal cases (`expected ==
 *  null`); REPORTED ONLY — the real gate (`gateAgainstThresholds`/
 *  `gateAgainstThresholdsNRuns`) always stays on the raw (pre-routing)
 *  refusal number, never this one. */
export function computeAfterRoutingRefusal(cases, resultsById, routedIds) {
  let correct = 0;
  let total = 0;
  let routed = 0;
  for (const c of cases) {
    if (c.expected != null) continue;
    if (routedIds.has(c.id)) {
      routed += 1;
      continue;
    }
    total += 1;
    if (casePassed(c, resultsById.get(c.id))) correct += 1;
  }
  return { correct, total, routed, rate: total ? correct / total : null };
}

// ─── M1 — category-vocabulary breakdown ─────────────────────────────────────

/** The dev-default category vocabulary: the 12-category list that most dev
 *  cases carry (`test-gates.mjs` pins this against the committed dataset). A
 *  case is "default-like" when its `context.categories` introduces NO name
 *  outside this list (a subset of the default vocabulary, e.g. the default
 *  list minus Gas and Other Income); it is "custom" when it contains at least
 *  one name that is not in the dev default list (Food, Transit, Eating Out,
 *  Bills, Kids, ...). A strict list-equality rule would put every holdout-v2
 *  case in "custom" (none of its lists equals the dev default exactly) and
 *  make the split useless, so the rule is vocabulary-based: it is the NAMES
 *  the model has not seen in dev that shift the category task. */
export const DEFAULT_VOCABULARY = [
  ['Dining', 'expense'],
  ['Groceries', 'expense'],
  ['Transport', 'expense'],
  ['Rent', 'expense'],
  ['Entertainment', 'expense'],
  ['Personal Care', 'expense'],
  ['Utilities', 'expense'],
  ['Shopping', 'expense'],
  ['Health', 'expense'],
  ['Gas', 'expense'],
  ['Salary', 'income'],
  ['Other Income', 'income'],
];

const DEFAULT_VOCABULARY_KEYS = new Set(DEFAULT_VOCABULARY.map(([n, k]) => `${n}|${k}`));

/** `'default'` iff the case's category list is non-empty and every (name,
 *  kind) in it is in `DEFAULT_VOCABULARY`, else `'custom'` (including a
 *  missing or empty list: `[].every(...)` is vacuously true, which would
 *  otherwise call a case with no categories at all "default-like"). */
export function vocabularyGroup(caseObj) {
  const cats = caseObj.context?.categories;
  if (!Array.isArray(cats) || cats.length === 0) return 'custom';
  return cats.every((c) => DEFAULT_VOCABULARY_KEYS.has(`${c.name}|${c.kind}`)) ? 'default' : 'custom';
}

/** Per vocabulary group (`default` / `custom`): case count, parse-case pass
 *  rate (every asserted field right), `ledgerCorrect`, `category` accuracy
 *  (asserted cases only) and refusal rate — each `{ correct, total, rate }`.
 *  A group with no cases is omitted. */
export function computeVocabularyBreakdown(cases, resultsById) {
  const out = {};
  for (const group of ['default', 'custom']) {
    const groupCases = cases.filter((c) => vocabularyGroup(c) === group);
    if (groupCases.length === 0) continue;
    const parseCases = groupCases.filter((c) => c.expected != null);
    const parseCorrect = parseCases.filter((c) => casePassed(c, resultsById.get(c.id))).length;
    out[group] = {
      cases: groupCases.length,
      parse: { correct: parseCorrect, total: parseCases.length, rate: parseCases.length ? parseCorrect / parseCases.length : null },
      ledgerCorrect: computeLedgerCorrect(groupCases, resultsById),
      category: computeFieldAccuracy(groupCases, resultsById, null, 'category'),
      refusal: computeFieldAccuracy(groupCases, resultsById, null, 'refusal'),
    };
  }
  return out;
}

/** Everything M3 restructures into `thresholds.json`'s `targets` needs for
 *  one run: `ledgerCorrect`, per-class `recall` (income/transfer), and the
 *  grouped-strata + per-axis target-field breakdowns, plus (review Major 2)
 *  the per-refusal-subtype breakdown. Computed from ONE run (`results`) —
 *  same convention as `firstRunFieldAccuracy` elsewhere (run-eval.mjs):
 *  informational for the pass-rate (`--n`-repeat) mode, not a second gate. */
export function computeExtendedMetrics(cases, results) {
  const resultsById = new Map(results.map((r) => [r.id, r]));
  return {
    ledgerCorrect: computeLedgerCorrect(cases, resultsById),
    recall: {
      income: computeClassRecall(cases, resultsById, 'income'),
      transfer: computeClassRecall(cases, resultsById, 'transfer'),
    },
    strata: computeAllStrata(cases, resultsById),
    perAxisTargetField: computeAxisTargetFieldAccuracy(cases, resultsById),
    refusalBySubtype: computeRefusalSubtypeBreakdown(cases, resultsById),
    byVocabulary: computeVocabularyBreakdown(cases, resultsById),
  };
}

// ─── M6/M3 — per-run metrics and named estimators ───────────────────────────

/** Which estimator each reported figure uses (recorded on every artifact and
 *  printed with every run). Two different estimators coexist and must never
 *  be silently mixed:
 *   - `parse` / `refusal`: the PASS-RATE estimator — the share of cases whose
 *     per-case pass-rate across the N runs is >= `thresholds.model.perCase`
 *     ("reliable >= 0.6"); this is what the gate uses.
 *   - everything else: computed PER RUN, reported as the mean over the N runs
 *     with min-max (a single value when N=1). Pre-M6 artifacts used run-0 only. */
export const ESTIMATORS = {
  parse: 'pass-rate: share of parse cases reliable (per-case pass-rate >= perCase 0.6)',
  refusal: 'pass-rate: share of refusal cases reliable (per-case pass-rate >= perCase 0.6)',
  others:
    'per-run value, reported as mean over the N runs with min-max (ledgerCorrect, recall, strata, refusal subtypes, vocabulary groups, field accuracy)',
};

/** Flattens one run's metrics to `{ 'dotted.path': { rate, total } }` — the
 *  rate-bearing leaves only. `report` is that run's `aggregate()` report. */
export function flattenRunMetrics(ext, report) {
  const flat = {};
  const put = (key, m) => {
    if (m && m.rate != null) flat[key] = { rate: m.rate, total: m.total };
  };
  put('ledgerCorrect', ext.ledgerCorrect);
  put('recall.income', ext.recall.income);
  put('recall.transfer', ext.recall.transfer);
  for (const [name, m] of Object.entries(ext.strata)) put(`strata.${name}`, m);
  for (const [name, m] of Object.entries(ext.refusalBySubtype)) put(`refusalBySubtype.${name}`, m);
  for (const [group, g] of Object.entries(ext.byVocabulary ?? {})) {
    for (const k of ['parse', 'ledgerCorrect', 'category', 'refusal']) put(`byVocabulary.${group}.${k}`, g[k]);
  }
  for (const [f, acc] of Object.entries(report.fieldAccuracy)) {
    if (acc != null) flat[`fieldAccuracy.${f}`] = { rate: acc, total: report.fieldCounts[f].total };
  }
  put('perRunParse', { rate: report.parseAccuracy, total: report.counts.parseTotal });
  put('perRunRefusal', { rate: report.failToParseAccuracy, total: report.counts.failToParseTotal });
  return flat;
}

/** `computeExtendedMetrics` + `aggregate` for EVERY run, then mean/min/max per
 *  metric: `{ runs, metrics: { path: { total, mean, min, max, perRun } } }`.
 *  A metric that is n/a (empty population) in a run is skipped for that run. */
export function computePerRunMetrics(cases, runs, engine = 'engine') {
  const perRunFlat = runs.map((run) =>
    flattenRunMetrics(computeExtendedMetrics(cases, run), aggregate(cases, { [engine]: run })[engine])
  );
  const keys = [...new Set(perRunFlat.flatMap((f) => Object.keys(f)))].sort();
  const metrics = {};
  for (const key of keys) {
    const rates = perRunFlat.map((f) => f[key]?.rate).filter((r) => r != null);
    metrics[key] = {
      total: perRunFlat.find((f) => f[key])[key].total,
      mean: rates.reduce((a, b) => a + b, 0) / rates.length,
      min: Math.min(...rates),
      max: Math.max(...rates),
      perRun: rates,
    };
  }
  return { runs: runs.length, metrics };
}

/** `"mean% (min-max%)"`, or just `"x%"` for a single run / flat spread. */
export function formatSpread(m) {
  if (!m) return 'n/a';
  if (m.perRun.length <= 1 || m.min === m.max) return pct(m.mean);
  return `${pct(m.mean)} (${pct(m.min)}-${pct(m.max)})`;
}

/** Whether the tree has uncommitted changes to anything a run's numbers
 *  actually depend on: the shared parse-prompt module, the
 *  rest of `src/domain` (localParse, the shared retry helper, etc.),
 *  `src/lib` (shared normalize/guard/validation helpers the BYOK and
 *  on-device engines both run through), `src/features/ai` (the BYOK
 *  transports + `deviceParse.ts` itself), `package-lock.json` (a dependency
 *  bump — e.g. `ai`/`zod`/`@ai-sdk/provider-utils` — can silently change
 *  `zodSchema()`'s behaviour without any of the above changing), or anything
 *  under `evals/** Repo-relative path of the relative-bar REFERENCE artifact that a run of
 *  `engine` on `datasetSplit` reads as an INPUT (`evals/results/<ref>[.split].json`),
 *  or `null` when there is no relative bar or `engine` IS the reference (then
 *  that file is the run's own output). Shared by the loader and `isRepoDirty`
 *  so the two can never disagree about which file is the input. */
export function referenceArtifactRelPath(rel, engine, datasetSplit) {
  if (!rel?.referenceEngine || rel.referenceEngine === engine) return null;
  const suffix = datasetSplit === 'all' ? '' : `.${datasetSplit}`;
  return `evals/results/${rel.referenceEngine}${suffix}.json`;
}

/** Frozen paired-comparison baselines: INPUTS that live under `evals/results/`. */
const FROZEN_BASELINE_RAW = /^evals\/results\/raw\/[^/]*\.baseline-[^/]*$/;

/** Whether `p` (repo-relative) is something a run WRITES, so its drift must
 *  not mark the artifact dirty: anything under `evals/results/` (artifacts,
 *  raw per-run files) and the holdout-look log, EXCEPT the run's inputs: the
 *  frozen `raw/*.baseline-*` files and the relative-bar reference artifact. */
function isRunOutput(p, referenceArtifact) {
  if (p === 'evals/holdout-looks.json') return true;
  if (!p.startsWith('evals/results/')) return false;
  return !FROZEN_BASELINE_RAW.test(p) && p !== referenceArtifact;
}

/** Whether any file that can change an engine's output has uncommitted edits:
 *  `src/domain` (the shared parse core both on-device engines run through),
 *  `src/lib`, `src/features/ai` (the BYOK transports + `deviceParse.ts`),
 *  `package.json` / `package-lock.json` (a dependency bump, e.g. `ai`/`zod`/
 *  `@ai-sdk/provider-utils`, can silently change `zodSchema()`'s behaviour),
 *  `patches/` (patch-package changes to a dependency), or anything under
 *  `evals/**` (the dataset, the scorer, the probe SOURCE). `null` (not
 *  `false`) when git itself is unavailable: "unknown", never a false claim of
 *  "clean".
 *
 *  Ignored, because they are THIS RUN's OWN output rather than an input:
 *  `evals/results/**` (the artifact, the raw per-run files) and
 *  `evals/holdout-looks.json` (the look-log entry `guardAndLogHoldoutLook`
 *  writes before the engine even runs; without this exclusion a confirmed
 *  holdout run would ALWAYS self-report `dirty: true`).
 *
 *  Still counted, because they are INPUTS that happen to live there: frozen
 *  `evals/results/raw/*.baseline-*` files, and `referenceArtifact` (the
 *  repo-relative path of the relative-bar reference artifact the run compares
 *  against; see `referenceArtifactRelPath`). */
export function isRepoDirty(repoRoot, { referenceArtifact = null } = {}) {
  try {
    const out = execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--untracked-files=all',
        '--',
        'src/domain',
        'src/lib',
        'src/features/ai',
        'package.json',
        'package-lock.json',
        'patches',
        'evals',
      ],
      { encoding: 'utf8', cwd: repoRoot }
    );
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).split(' -> ').pop().trim())
      .some((p) => !isRunOutput(p, referenceArtifact));
  } catch {
    return null;
  }
}

/** The two fields that trivially change on every run regardless of whether
 *  anything about the SCORE did. */
function withoutVolatileFields(obj) {
  const { gitSha: _gitSha, generatedAt: _generatedAt, ...rest } = obj;
  return rest;
}

/** ARTIFACT CHURN: true iff `candidate` is identical to
 *  `existing` in every field EXCEPT `gitSha`/`generatedAt` — i.e. a re-run
 *  produced no real change, so the artifact file should be left untouched
 *  (keeping its OLDER `gitSha`/`generatedAt`) rather than rewritten, so
 *  `git diff` on a clean re-run of an unrelated change stays empty instead
 *  of showing a no-op timestamp/SHA bump. `existing` may be `null` (no
 *  committed file yet), in which case this is always `false`. */
export function isArtifactUnchanged(existing, candidate) {
  if (!existing) return false;
  return JSON.stringify(withoutVolatileFields(existing)) === JSON.stringify(withoutVolatileFields(candidate));
}

// ─── M2 — the relative "replace BYOK" bar ───────────────────────────────────

/** Evaluates `thresholds.targets.relativeToByok` for one engine against the
 *  ONE named reference engine's per-run metrics (`computePerRunMetrics(...)
 *  .metrics` maps for both). Pure.
 *
 *  - `ledgerCorrect`: engine mean >= reference mean - `ledgerCorrectGapPoints`.
 *  - income / transfer recall: engine's expected misses (mean over runs) <=
 *    the reference's + `recallMaxExtraMissesVsByok[class]` cases.
 *  - Refusal is NOT relative to the reference at all: it is the absolute
 *    `targets.refusal` bar plus a per-subtype report (`refusalSubtypes`). The
 *    subtypes named in `reportSeparatelyFromRefusal.refusalSubtypes`
 *    (finance-near-miss, today) are still reported per subtype but are left
 *    out of `refusalComparable`, the aggregate refusal share over the OTHER
 *    subtypes, because no engine prompt encodes their refuse rule yet, so a
 *    score there measures prompt wording rather than model quality.
 *
 *  Returns `{ reference, rows, refusalSubtypes, refusalComparable,
 *  reportedSeparately }`, or `rows: []` when no reference metrics are
 *  available. */
export function evaluateRelativeBar(rel, metrics, referenceMetrics) {
  const reportedSeparately = rel?.reportSeparatelyFromRefusal?.refusalSubtypes ?? [];
  const subtypeKeys = Object.keys(metrics).filter((k) => k.startsWith('refusalBySubtype.'));
  const refusalSubtypes = Object.fromEntries(
    subtypeKeys.map((k) => [k.slice('refusalBySubtype.'.length), metrics[k]])
  );
  const kept = Object.entries(refusalSubtypes).filter(([name]) => !reportedSeparately.includes(name));
  const keptTotal = kept.reduce((a, [, m]) => a + m.total, 0);
  const refusalComparable = keptTotal
    ? { total: keptTotal, mean: kept.reduce((a, [, m]) => a + m.mean * m.total, 0) / keptTotal }
    : null;
  const out = { reference: rel?.referenceLabel ?? null, rows: [], refusalSubtypes, refusalComparable, reportedSeparately };
  if (!rel || !referenceMetrics) return out;

  const lc = metrics.ledgerCorrect;
  const refLc = referenceMetrics.ledgerCorrect;
  if (lc && refLc) {
    const gapPoints = (refLc.mean - lc.mean) * 100;
    out.rows.push({
      key: 'ledgerCorrect',
      engine: lc,
      reference: refLc,
      detail: `${gapPoints <= 0 ? 'ahead by' : 'short by'} ${Math.abs(gapPoints).toFixed(1)} pts (allowed gap ${rel.ledgerCorrectGapPoints})`,
      meets: gapPoints <= rel.ledgerCorrectGapPoints + 1e-9,
    });
  }
  for (const cls of ['income', 'transfer']) {
    const m = metrics[`recall.${cls}`];
    const ref = referenceMetrics[`recall.${cls}`];
    const allowance = rel.recallMaxExtraMissesVsByok?.[cls];
    if (!m || !ref || allowance == null) continue;
    const misses = m.total * (1 - m.mean);
    const refMisses = ref.total * (1 - ref.mean);
    out.rows.push({
      key: `recall.${cls}`,
      engine: m,
      reference: ref,
      detail: `${misses.toFixed(1)} misses vs reference ${refMisses.toFixed(1)} (allowed +${allowance})`,
      meets: misses <= refMisses + allowance + 1e-9,
    });
  }
  return out;
}

/** Decides whether a committed reference artifact is a valid comparator for
 *  the CURRENT run: `{ metrics }` when it is, `{ skip: reason }` when not.
 *  `current` is `{ datasetLabelSha, caseCount }` of the cases the current run
 *  scored (see provenance.mjs). A relative bar against a reference measured on
 *  other labels, or on a different number of cases, compares two different
 *  tests, so it is skipped, never approximated. An artifact that predates the
 *  provenance fields is unverifiable and skipped too (re-score it offline with
 *  `rescore.mjs --write` to stamp it). Pure. */
export function checkReferenceArtifact(art, rel, current) {
  if (art.model !== rel.referenceModel) {
    return { skip: `reference artifact is model "${art.model}", not the named ${rel.referenceModel}` };
  }
  if (!art.perRunMetrics?.metrics) return { skip: 'reference artifact predates per-run metrics' };
  if (!art.datasetLabelSha) {
    return { skip: 'reference artifact records no datasetLabelSha (it predates label provenance), so its labels cannot be verified' };
  }
  if (art.datasetLabelSha !== current.datasetLabelSha) {
    return { skip: `reference label hash ${art.datasetLabelSha} != this run's ${current.datasetLabelSha} (the labels changed)` };
  }
  const refCount = art.caseCount ?? art.cases?.length;
  if (refCount !== current.caseCount) {
    return { skip: `reference artifact scored ${refCount} case(s), this run ${current.caseCount}` };
  }
  return { metrics: art.perRunMetrics.metrics };
}
