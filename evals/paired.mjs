#!/usr/bin/env node
/**
 * Paired comparison of two stored raw runs on the SAME split (dev tooling —
 * never ships): an exact McNemar test per metric, so "candidate beat baseline"
 * is a count of cases that flipped, with a p-value, not two overlapping
 * percentages. Calls no model and spends no holdout look.
 *
 *   node evals/paired.mjs <baseline.jsonl> <candidate.jsonl> [--per-case=0.6]
 *
 * The unit is a CASE. A case is RELIABLE for a metric when it is right in at
 * least `perCase` of that file's runs (default thresholds.json model.perCase,
 * the same rule as the artifact's parse / refusal pass-rates):
 *   parse          parse cases (label asserts an expense): every asserted field right
 *   ledgerCorrect  parse cases: amountMinor, sign and dateISO right
 *   refusal        refusal cases (expected null): the engine returned null
 * `wins` = reliable only in the candidate, `losses` = reliable only in the
 * baseline. p is the two-sided exact binomial (McNemar) over the discordant
 * cases; with none, p = 1. Only the ids both files hold are paired.
 *
 * Freeze the baseline first (`results/raw/<engine>.<split>.baseline-<sha>.jsonl`,
 * which no run ever overwrites) so the comparison stays reproducible.
 *
 * CONTAMINATION: a holdout raw file holds per-case model output. This tool
 * prints counts only, never case ids, and must not be used to hunt for which
 * cases flipped while tuning (see README "Holdout discipline").
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './split.mjs';
import { readRaw } from './raw.mjs';
import { casePassed, pct } from './gates.mjs';
import { scoreCase } from './score.mjs';
import { assertReconstructedLabelsCurrent } from './provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const METRICS = ['parse', 'ledgerCorrect', 'refusal'];

/** Two-sided exact McNemar p: `2 * P(X <= min(wins, losses))` for
 *  X ~ Binomial(wins + losses, 1/2), capped at 1. No discordant cases -> 1. */
export function mcnemarExact(wins, losses) {
  const n = wins + losses;
  if (n === 0) return 1;
  const k = Math.min(wins, losses);
  // Sum C(n, i) / 2^n iteratively; exact enough for any realistic n (<= a few hundred).
  let term = 2 ** -n;
  let tail = term;
  for (let i = 1; i <= k; i++) {
    term = (term * (n - i + 1)) / i;
    tail += term;
  }
  return Math.min(1, 2 * tail);
}

function ledgerCorrect(c, result) {
  if (!result || result.status === 'error') return false;
  const { fields } = scoreCase(c.expected, result.parse ?? null, c.id);
  return Boolean(fields.amountMinor && fields.sign && fields.dateISO);
}

/** `{ parse, ledgerCorrect, refusal }` -> Map<id, boolean> of RELIABLE cases
 *  (right in >= `perCase` of `runs`), over the metric's own population only. */
export function reliableByMetric(cases, runs, perCase) {
  const byRun = runs.map((run) => new Map(run.map((r) => [r.id, r])));
  const reliable = (c, test) => byRun.filter((m) => test(c, m.get(c.id))).length / byRun.length >= perCase;
  const out = { parse: new Map(), ledgerCorrect: new Map(), refusal: new Map() };
  for (const c of cases) {
    if (c.expected == null) {
      out.refusal.set(c.id, reliable(c, casePassed));
    } else {
      out.parse.set(c.id, reliable(c, casePassed));
      out.ledgerCorrect.set(c.id, reliable(c, ledgerCorrect));
    }
  }
  return out;
}

/** Pure: McNemar rows from two runs sets on the same `cases`. */
export function pairedFromRuns(cases, runsA, runsB, perCase) {
  const a = reliableByMetric(cases, runsA, perCase);
  const b = reliableByMetric(cases, runsB, perCase);
  const rows = {};
  for (const metric of METRICS) {
    let wins = 0;
    let losses = 0;
    let both = 0;
    let neither = 0;
    for (const [id, inA] of a[metric]) {
      const inB = b[metric].get(id);
      if (inA && inB) both += 1;
      else if (inB) wins += 1;
      else if (inA) losses += 1;
      else neither += 1;
    }
    const n = a[metric].size;
    rows[metric] = {
      n,
      baseline: n ? (both + losses) / n : null,
      candidate: n ? (both + wins) / n : null,
      wins,
      losses,
      both,
      neither,
      p: mcnemarExact(wins, losses),
    };
  }
  return rows;
}

/** Compares two raw files (baseline first). Throws if they are for different
 *  splits, or either is a reconstruction whose labels changed. */
export function pairedFromRawFiles(fileA, fileB, { cases, perCase } = {}) {
  const A = readRaw(fileA);
  const B = readRaw(fileB);
  if (A.header.datasetSplit !== B.header.datasetSplit) {
    throw new Error(`different splits: ${fileA} is ${A.header.datasetSplit}, ${fileB} is ${B.header.datasetSplit}`);
  }
  const all = cases ?? loadCases(A.header.datasetSplit);
  assertReconstructedLabelsCurrent(A.header, all.filter((c) => A.runs[0].some((r) => r.id === c.id)), fileA);
  assertReconstructedLabelsCurrent(B.header, all.filter((c) => B.runs[0].some((r) => r.id === c.id)), fileB);
  const idsA = new Set(A.runs[0].map((r) => r.id));
  const idsB = new Set(B.runs[0].map((r) => r.id));
  const common = all.filter((c) => idsA.has(c.id) && idsB.has(c.id));
  if (common.length === 0) throw new Error('the two files share no case of the current dataset');
  const threshold = perCase ?? JSON.parse(readFileSync(path.join(__dirname, 'thresholds.json'), 'utf8')).model.perCase;
  return {
    split: A.header.datasetSplit,
    baseline: { engine: A.header.engine, model: A.header.model, runs: A.runs.length },
    candidate: { engine: B.header.engine, model: B.header.model, runs: B.runs.length },
    perCase: threshold,
    paired: common.length,
    notPaired: { baselineOnly: idsA.size - common.length, candidateOnly: idsB.size - common.length },
    rows: pairedFromRuns(common, A.runs, B.runs, threshold),
  };
}

function print(r) {
  console.log(`paired (exact McNemar), split=${r.split}, ${r.paired} case(s) paired, reliable = right in >= ${pct(r.perCase)} of runs`);
  console.log(`  baseline  ${r.baseline.engine} (${r.baseline.model}), ${r.baseline.runs} run(s)`);
  console.log(`  candidate ${r.candidate.engine} (${r.candidate.model}), ${r.candidate.runs} run(s)`);
  if (r.notPaired.baselineOnly || r.notPaired.candidateOnly) {
    console.log(`  not paired (id in only one file): baseline ${r.notPaired.baselineOnly}, candidate ${r.notPaired.candidateOnly}`);
  }
  console.log(`  ${'metric'.padEnd(14)} ${'n'.padStart(4)} ${'baseline'.padStart(9)} ${'candidate'.padStart(10)} ${'wins'.padStart(5)} ${'losses'.padStart(7)} ${'p'.padStart(7)}`);
  for (const [metric, m] of Object.entries(r.rows)) {
    console.log(
      `  ${metric.padEnd(14)} ${String(m.n).padStart(4)} ${pct(m.baseline).padStart(9)} ${pct(m.candidate).padStart(10)} ` +
        `${String(m.wins).padStart(5)} ${String(m.losses).padStart(7)} ${m.p.toFixed(4).padStart(7)}`
    );
  }
}

function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith('--'));
  const perCaseArg = args.find((a) => a.startsWith('--per-case='))?.slice('--per-case='.length);
  if (files.length !== 2) {
    console.error('usage: node evals/paired.mjs <baseline.jsonl> <candidate.jsonl> [--per-case=0.6]');
    process.exit(2);
  }
  print(pairedFromRawFiles(path.resolve(files[0]), path.resolve(files[1]), { perCase: perCaseArg == null ? undefined : Number(perCaseArg) }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
