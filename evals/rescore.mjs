#!/usr/bin/env node
/**
 * Offline re-score (dev tooling — never ships). Re-scores a stored raw
 * per-run file (`evals/results/raw/<engine>.<split>.jsonl`, written by every
 * model-tier run — see raw.mjs) against the CURRENT dataset labels, calling no
 * model and spending no holdout look. Use it after a label fix instead of a
 * paid / on-device re-run.
 *
 * Usage:
 *   node evals/rescore.mjs evals/results/raw/fm.holdout2.jsonl            # print the summary
 *   node evals/rescore.mjs <raw> --write --reason="..."                   # also rewrite the artifact
 *
 * `--write` rewrites `evals/results/<engine>.<split>.json` (suffixless for
 * `all`) with the freshly scored payload and a `rescoredOffline` provenance
 * block (what it was re-scored from, why, when, at which git SHA). The
 * artifact's envelope (model, command, fmEnvironment, ...) is kept from the
 * existing file: the numbers changed, the run did not.
 *
 * CONTAMINATION: a holdout raw file contains per-case model outputs; do not
 * read it while tuning (see README "Holdout discipline"). This tool only
 * aggregates it.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases, gitSha } from './split.mjs';
import { readRaw } from './raw.mjs';
import { scoreModelRuns, getRoutedIds } from './artifact.mjs';
import { isRepoDirty, pct, formatSpread, referenceArtifactRelPath } from './gates.mjs';
import { assertReconstructedLabelsCurrent, datasetLabelSha } from './provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RESULTS_DIR = path.join(__dirname, 'results');
const THRESHOLDS_PATH = path.join(__dirname, 'thresholds.json');

/** Pure-ish core: raw file -> scored payload against `cases` (default: the
 *  current dataset's cases for the file's split, restricted to the ids the raw
 *  file actually holds — a dev case added after the run has no raw data).
 *  `routedIds` defaults to the real `detectIntent` (a free local `tsx`
 *  subprocess).
 *
 *  Throws (never guesses) when the file is inconsistent across runs (readRaw)
 *  or is a lossy RECONSTRUCTION whose labels changed since it was built. */
export function rescoreRaw(rawFile, { cases, thresholds, routedIds, io = { log() {}, error() {} } } = {}) {
  const { header, runs } = readRaw(rawFile);
  const have = new Set(runs[0].map((r) => r.id));
  const allCases = cases ?? loadCases(header.datasetSplit);
  const scoredCases = allCases.filter((c) => have.has(c.id));
  const unscored = allCases.filter((c) => !have.has(c.id)).map((c) => c.id);
  assertReconstructedLabelsCurrent(header, scoredCases, rawFile);
  const th = thresholds ?? JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8'));
  const scored = scoreModelRuns({
    engine: header.engine,
    cases: scoredCases,
    runs,
    thresholds: th,
    routedIds: routedIds ?? getRoutedIds(scoredCases),
    io,
  });
  return { header, cases: scoredCases, unscored, scored };
}

export function artifactPathFor(engine, datasetSplit) {
  const suffix = datasetSplit === 'all' ? '' : `.${datasetSplit}`;
  return path.join(RESULTS_DIR, `${engine}${suffix}.json`);
}

/** Build the rewritten artifact: existing envelope + fresh payload + provenance. */
export function buildRescoredArtifact(existing, { header, cases, unscored = [], scored }, { reason, rawRelPath, sha, dirty, now = new Date() }) {
  const { gitSha: _g, generatedAt: _t, dirty: _d, ...envelopeAndOld } = existing ?? {};
  const envelope = {};
  for (const k of ['engine', 'model', 'datasetFile', 'metric', 'fmEnvironment', 'mode', 'samples', 'status', 'datasetSplit', 'command']) {
    if (k in envelopeAndOld) envelope[k] = envelopeAndOld[k];
  }
  return {
    engine: header.engine,
    model: header.model,
    gitSha: sha,
    generatedAt: now.toISOString(),
    dirty,
    ...envelope,
    mode: scored.n === 1 ? 'single-sample' : 'pass-rate',
    samples: scored.n,
    status: 'ok',
    datasetSplit: header.datasetSplit,
    // What this re-score was measured against. The prompt sha is the RUN's, not
    // today's source: taken from the raw header, `null` when the raw predates it.
    datasetLabelSha: datasetLabelSha(cases),
    caseCount: cases.length,
    parsePromptSha: header.parsePromptSha ?? null,
    command: envelope.command ?? header.command,
    rescoredOffline: {
      reason,
      from: rawRelPath,
      originalGitSha: header.gitSha, // the raw file's header identifies the run itself, even across repeated re-scores
      originalGeneratedAt: header.generatedAt,
      rescoredAt: now.toISOString(),
      unscored,
      note: 'Re-scored OFFLINE from stored per-run parses against the current dataset labels; no model was called and no holdout look was spent.',
      ...(header.reconstructed ? { rawReconstructed: header.reconstructed } : {}),
    },
    ...scored.payload,
  };
}

function refRel() {
  return JSON.parse(readFileSync(THRESHOLDS_PATH, 'utf8')).targets?.relativeToByok;
}

function summarize({ header, cases, unscored, scored }) {
  const m = scored.perRun.metrics;
  console.log(`rescore: ${header.engine} (${header.model}) split=${header.datasetSplit} runs=${scored.n} cases=${cases.length}`);
  if (unscored.length) console.log(`  (${unscored.length} current case(s) have no raw data and are not scored: ${unscored.join(', ')})`);
  console.log(`  parse (pass-rate, reliable>=60%)   ${pct(scored.parseRate)}`);
  console.log(`  refusal (pass-rate, reliable>=60%) ${pct(scored.refusalRate)}`);
  for (const k of ['ledgerCorrect', 'recall.income', 'recall.transfer', 'fieldAccuracy.amountMinor']) {
    console.log(`  ${k.padEnd(34)} ${formatSpread(m[k])}   [mean of ${scored.n} run(s), min-max]`);
  }
}

function main() {
  const args = process.argv.slice(2);
  const rawFile = args.find((a) => !a.startsWith('--'));
  const write = args.includes('--write');
  const reason = args.find((a) => a.startsWith('--reason='))?.slice('--reason='.length);
  if (!rawFile || (write && !reason)) {
    console.error('usage: node evals/rescore.mjs <raw.jsonl> [--write --reason="..."]');
    process.exit(2);
  }
  const abs = path.resolve(rawFile);
  const result = rescoreRaw(abs, { io: console });
  summarize(result);
  if (!write) return;
  const out = artifactPathFor(result.header.engine, result.header.datasetSplit);
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(out, 'utf8'));
  } catch {
    existing = null;
  }
  const artifact = buildRescoredArtifact(existing, result, {
    reason,
    rawRelPath: path.relative(REPO_ROOT, abs),
    sha: gitSha(),
    dirty: isRepoDirty(REPO_ROOT, {
      referenceArtifact: referenceArtifactRelPath(refRel(), result.header.engine, result.header.datasetSplit),
    }),
  });
  writeFileSync(out, JSON.stringify(artifact, null, 2) + '\n');
  console.log(`rescore: wrote ${path.relative(REPO_ROOT, out)} (rescoredOffline: "${reason}")`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
