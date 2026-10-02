/**
 * Raw per-run storage (dev tooling — never ships). Every model-tier run
 * writes its per-case, per-run parses to `evals/results/raw/<engine>.<split>.jsonl`
 * so a future LABEL fix can be re-scored offline (`evals/rescore.mjs`) without
 * a paid or on-device re-run.
 *
 * File format (JSONL):
 *   line 1  header: `{ "_header": true, "warning"?, engine, model, datasetSplit,
 *           samples, gitSha, generatedAt, command, reconstructed? }`
 *   then    one line per (run, case): `{ "run": 0, "id": "...", "status": "ok",
 *           "parse": {...}|null, "reason"?, "error"? }`
 *
 * FROZEN BASELINES: a file named `<engine>.<split>.baseline-<sha>.jsonl` is a
 * frozen copy kept for paired comparisons (`evals/paired.mjs`). A run never
 * writes one (`assertNotFrozen`), and editing one makes `isRepoDirty` true.
 *
 * Holdout files (`holdout`, `holdout2`, `all`) carry a contamination warning
 * in the header: they contain per-case model outputs, and reading them while
 * tuning contaminates the holdout.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isGuardedSplit } from './split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RAW_DIR = path.join(__dirname, 'results', 'raw');

export const HOLDOUT_RAW_WARNING =
  'contains per-case model outputs; reading this while tuning contaminates the holdout';

export function rawPathFor(engine, split, rawDir = RAW_DIR) {
  return path.join(rawDir, `${engine}.${split}.jsonl`);
}

/** A frozen baseline copy (`<engine>.<split>.baseline-<sha>.jsonl`). */
export const FROZEN_RAW_RE = /\.baseline-[^/\\]*\.jsonl$/;

/** Throws if `file` is a frozen baseline: no run may overwrite one. */
export function assertNotFrozen(file) {
  if (FROZEN_RAW_RE.test(file)) {
    throw new Error(`refusing to write ${file}: a *.baseline-* raw file is a frozen baseline and is never overwritten`);
  }
}

/** What re-scoring needs: the status/parse, plus the FM probe's compact
 *  per-case `diagnostics` (attempt counts, schema orders) so an offline
 *  re-score can rebuild the same per-case diagnostics an artifact carries. */
function slimResult(run, r) {
  return {
    run,
    id: r.id,
    status: r.status,
    parse: r.parse ?? null,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.error ? { error: r.error } : {}),
    ...(r.diagnostics ? { diagnostics: r.diagnostics } : {}),
  };
}

export function buildRawLines(header, runs) {
  const lines = [JSON.stringify({ _header: true, ...header })];
  runs.forEach((results, run) => {
    for (const r of results) lines.push(JSON.stringify(slimResult(run, r)));
  });
  return lines;
}

/** Writes the raw file; a re-run whose per-case body is byte-identical to the
 *  committed file is left untouched (no gitSha/timestamp churn). Returns the
 *  path, or `null` when nothing was written. Non-fatal by design at the call
 *  site (a provenance write must not change a gate's exit code). */
export function writeRaw({ engine, model, datasetSplit, command, gitSha, runs, rawDir = RAW_DIR, extraHeader = {} }) {
  const header = {
    ...(isGuardedSplit(datasetSplit) ? { warning: HOLDOUT_RAW_WARNING } : {}),
    engine,
    model,
    datasetSplit,
    samples: runs.length,
    gitSha,
    generatedAt: new Date().toISOString(),
    command,
    ...extraHeader,
  };
  const lines = buildRawLines(header, runs);
  const file = rawPathFor(engine, datasetSplit, rawDir);
  assertNotFrozen(file);
  if (existsSync(file)) {
    const existing = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    if (existing.slice(1).join('\n') === lines.slice(1).join('\n')) return null;
  }
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

/** Every run in a raw file must hold the same case ids, each exactly once, and
 *  there must be as many runs as the header's `samples`. A gap (a run index
 *  with no lines), a sparse run (a case missing from one run) or a duplicate
 *  would otherwise be scored as if the file were whole: rescore takes the id
 *  set from run 0 and a missing case in a later run would read as a failure. */
export function assertRunsConsistent(header, runs, file = 'raw file') {
  const missingRuns = [...runs.keys()].filter((i) => runs[i] === undefined);
  if (missingRuns.length) throw new Error(`${file}: no lines for run(s) ${missingRuns.join(', ')} (a gap in the run indices)`);
  if (header.samples != null && header.samples !== runs.length) {
    throw new Error(`${file}: header says ${header.samples} run(s) but the file holds ${runs.length}`);
  }
  const idsOf = (run, i) => {
    const ids = run.map((r) => r.id);
    const dupes = ids.filter((id, k) => ids.indexOf(id) !== k);
    if (dupes.length) throw new Error(`${file}: run ${i} holds case(s) more than once: ${[...new Set(dupes)].join(', ')}`);
    return new Set(ids);
  };
  const first = idsOf(runs[0], 0);
  for (let i = 1; i < runs.length; i++) {
    const ids = idsOf(runs[i], i);
    const absent = [...first].filter((id) => !ids.has(id));
    const extra = [...ids].filter((id) => !first.has(id));
    if (absent.length || extra.length) {
      throw new Error(
        `${file}: run ${i} does not hold the same cases as run 0 (sparse run)` +
          (absent.length ? `; missing ${absent.length}: ${absent.slice(0, 10).join(', ')}` : '') +
          (extra.length ? `; extra ${extra.length}: ${extra.slice(0, 10).join(', ')}` : '')
      );
    }
  }
}

/** `{ header, runs }` where `runs[i]` is the array of that run's per-case
 *  results (`{ id, status, parse, ... }`). Throws on an inconsistent file
 *  (see `assertRunsConsistent`). */
export function readRaw(file) {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const header = lines[0];
  if (!header?._header) throw new Error(`${file}: first line is not a raw header`);
  const runs = [];
  for (const l of lines.slice(1)) {
    (runs[l.run] ??= []).push({
      id: l.id,
      status: l.status,
      parse: l.parse ?? null,
      ...(l.reason ? { reason: l.reason } : {}),
      ...(l.error ? { error: l.error } : {}),
      ...(l.diagnostics ? { diagnostics: l.diagnostics } : {}),
    });
  }
  if (runs.length === 0) throw new Error(`${file}: no per-case lines`);
  assertRunsConsistent(header, runs, file);
  return { header, runs };
}
