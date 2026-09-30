/**
 * Pure(ish) gate/scoring helpers for `evals/run-eval.mjs` (dev tooling —
 * never ships). Extracted out of `run-eval.mjs` (review N5) so they're
 * independently unit-testable via `evals/test-gates.mjs` without having to
 * shell out to the real dataset/engine runner — `run-eval.mjs` itself is
 * still the only place that wires these together with real I/O (reading
 * `evals/thresholds.json`, running the engine, writing the artifact).
 *
 * `isRepoDirty`'s pathspec (review Q1/N3) lives here too: it was missing
 * `src/lib`, `src/features/ai`, and `package-lock.json` — all of which can
 * change an engine's real output (the BYOK transports live under
 * `src/features/ai`, shared normalize/guard helpers under `src/lib`, and a
 * dependency bump can change `zodSchema()`'s behaviour) without the artifact
 * being marked `dirty`.
 */
import { execFileSync } from 'node:child_process';
import { scoreCase } from './score.mjs';

/** `n == null ? 'n/a' : "NN.N%"`. */
export function pct(n) {
  return n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`;
}

/** Whether one case counts as "passing" for baseline/regression purposes —
 *  a fail-to-parse case (`expected: null`) passes iff the engine returned
 *  `null`; any other case passes iff every scored field matches. An `error`
 *  status never counts as passing (review B2/S — a harness fault must never
 *  be scored as a pass in EITHER population). */
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
    // `error` included (review B2) — a harness fault's own reason belongs
    // right next to the diff entry that reports it, not only in the
    // engine report's separate top-level `errors` list.
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
 *  (review S4) sums, across every sample, how many attempts logged no
 *  extractable schema property order at all.
 *
 *  `sampleDiagnostics` (review S2) — only for a case with at least one
 *  failing sample — is ONE ENTRY PER SAMPLE (not deduplicated/merged across
 *  samples, unlike the rest of this function): `{ passed, attempts, wrongFields? }`,
 *  where `attempts` is that sample's own `attemptsDetail`
 *  (`[{ order, ok }]`, one per probe invocation within that sample). This
 *  is what actually ties a specific schema property order to a specific
 *  sample's pass/fail outcome — a case-wide deduplicated order SET (the
 *  previous `fieldOrdersObserved` shape) can't answer "did THIS order pass
 *  or fail", only "which orders occurred somewhere in this case's samples".
 *  Gated the same way `wrongFields` is (only cases with >=1 failing sample)
 *  to keep the artifact reasonably sized — a case that passed every sample
 *  regardless of order isn't an order-correlation candidate worth the extra
 *  bytes. */
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
    for (const run of runs) {
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
        attemptsPerRun.push(r.diagnostics.attempts);
        firstAttemptUsefulPerRun.push(r.diagnostics.firstAttemptUseful);
        orderUnavailable += r.diagnostics.orderUnavailable ?? 0;
        sampleDiagnostics.push({
          passed: samplePassed,
          attempts: r.diagnostics.attemptsDetail ?? [],
          ...(sampleWrongFields.length ? { wrongFields: sampleWrongFields } : {}),
        });
      }
    }
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

/** Sums `orderUnavailable` (review S4) across every case's diagnostics —
 *  the RUN-level count of probe attempts where `debugDescription`'s
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
 *  (`expected == null` — S5, the refusal-case definition used everywhere,
 *  not the dataset's `axis` label) split as `score.mjs`'s `parseAccuracy`/
 *  `failToParseAccuracy`, but over pass-rate reliability — a case counts iff
 *  its pass-rate clears `perCaseThreshold` (boundary-inclusive, `>=`: e.g.
 *  3/5 = 0.6 passes a 0.6 threshold). An EMPTY population's `rate` is `null`
 *  (n/a), never `0` — the caller (`gateAgainstThresholdsNRuns`) must treat
 *  that as "not gated", not as a failure (review N5: this was previously the
 *  source of a spurious FAIL on a dataset with no refusal cases, since
 *  `null ?? 0` reads as "0% reliable"). */
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
 *  clear their OWN bar separately (review S2) — the fraction of RELIABLE
 *  parse cases must clear `thresholds.model.parse`, and the fraction of
 *  RELIABLE refusal cases must clear `thresholds.model.refusal`. An EMPTY
 *  population (review N5) is reported "not gated" (n/a) rather than a
 *  spurious FAIL — there is nothing to be reliable (or unreliable) about. */
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
  return { passed, reliable: reliable.length, total: cases.length, overall, split };
}

/** Gates a single-sample model-tier run on parse-case and refusal-case
 *  accuracy SEPARATELY (review S2). An EMPTY population (review N5:
 *  `report.counts.parseTotal`/`failToParseTotal === 0`) is reported "not
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

/** Whether the tree has uncommitted changes to anything a run's numbers
 *  actually depend on (review S7/Q1): the shared parse-prompt module, the
 *  rest of `src/domain` (localParse, the shared retry helper, etc.),
 *  `src/lib` (shared normalize/guard/validation helpers the BYOK and
 *  on-device engines both run through), `src/features/ai` (the BYOK
 *  transports + `deviceParse.ts` itself), `package-lock.json` (a dependency
 *  bump — e.g. `ai`/`zod`/`@ai-sdk/provider-utils` — can silently change
 *  `zodSchema()`'s behaviour without any of the above changing), or anything
 *  under `evals/**` (the dataset, the scorer, the probe SOURCE). `null` (not
 *  `false`) when git itself is unavailable — "unknown", never a false claim
 *  of "clean". Excludes `evals/results/` from the check: that's this run's
 *  OWN output, not an input whose drift should mark the artifact `dirty`. */
export function isRepoDirty(repoRoot) {
  try {
    const out = execFileSync(
      'git',
      [
        'status',
        '--porcelain',
        '--',
        'src/domain',
        'src/lib',
        'src/features/ai',
        'package-lock.json',
        'evals',
      ],
      { encoding: 'utf8', cwd: repoRoot }
    );
    const lines = out
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .filter((l) => !l.includes('evals/results/'));
    return lines.length > 0;
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

/** ARTIFACT CHURN (review S7): true iff `candidate` is identical to
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
