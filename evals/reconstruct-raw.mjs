#!/usr/bin/env node
/**
 * Provenance for `results/raw/fm.holdout2.jsonl` (dev tooling — never ships).
 *
 * That raw file was NOT written by a run. The first FM holdout-v2 run (commit
 * bde1aeb) predates raw storage, so its per-case parses were rebuilt from the
 * committed artifact's per-case diagnostics (`sampleDiagnostics.wrongFields`,
 * `attemptsPerRun`, ...). This is that rebuild, kept so the file is
 * reproducible and checkable (`test-rescore.mjs` round-trips it against the
 * bde1aeb artifact).
 *
 * METHOD. FM is deterministic here (a case is 2/2 or 0/2). A sample has a wrong
 * field exactly when `sampleDiagnostics` lists it; its parse then carries the
 * RECORDED actual for the wrong fields and the LABEL's value for the right
 * ones. That is lossy: the right-field values are labels, not model output, so
 * if a label on a field FM got right changes, the file cannot be re-scored.
 * The header therefore stores a hash of every case's `expected`
 * (`labelHashes`), and `rescore.mjs` refuses the file when one has changed.
 *
 * Usage (writes into --out-dir only; never defaults to results/raw/):
 *   node evals/reconstruct-raw.mjs --artifact-ref=bde1aeb --out-dir=/tmp/x
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './split.mjs';
import { writeRaw } from './raw.mjs';
import { labelHashes } from './provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const noon = (iso) => Date.parse(`${iso}T12:00:00Z`);

/** One synthesized per-case result for sample `s` of case `c`, from the
 *  artifact's per-case record `rec`. */
function synthesize(c, rec, s) {
  const sample = (list) => list?.find((x) => x.sample === s);
  const diagnostics = {
    attempts: sample(rec.attemptsPerRun)?.attempts ?? 1,
    firstAttemptUseful: sample(rec.firstAttemptUsefulPerRun)?.firstAttemptUseful ?? true,
    attemptsDetail: sample(rec.sampleDiagnostics)?.attempts ?? [],
    orderUnavailable: 0,
  };
  const wrong = sample(rec.sampleDiagnostics)?.wrongFields ?? [];
  const get = (f) => wrong.find((w) => w.field === f);
  if (c.expected === null) {
    const p = get('parse');
    return {
      id: c.id,
      status: 'ok',
      parse: p ? { amount: p.actual.amount, type: p.actual.type, occurredAt: null, category: p.actual.category ?? null, payee: p.actual.payee ?? null } : null,
      diagnostics,
    };
  }
  if (get('parse')) return { id: c.id, status: 'ok', parse: null, diagnostics };
  if (get('status')) throw new Error(`unexpected error status for ${c.id}`);
  const e = c.expected;
  const pick = (f, fromLabel) => (get(f) ? get(f).actual : fromLabel);
  const dateWrong = get('dateISO');
  return {
    id: c.id,
    status: 'ok',
    parse: {
      amount: pick('amountMinor', e.amountMinor),
      type: pick('sign', e.sign),
      occurredAt: dateWrong ? (dateWrong.actual ? noon(dateWrong.actual) : null) : noon(e.dateISO),
      category: pick('category', e.category),
      payee: pick('payee', e.payee),
    },
    diagnostics,
  };
}

/** Pure: the per-run result arrays rebuilt from `artifact` against `cases`. */
export function reconstructRuns(artifact, cases) {
  const byId = new Map(artifact.cases.map((c) => [c.id, c]));
  return Array.from({ length: artifact.samples }, (_, s) =>
    cases.map((c) => {
      const rec = byId.get(c.id);
      if (!rec) throw new Error(`artifact has no record for case ${c.id}`);
      return synthesize(c, rec, s);
    })
  );
}

/** The header fields a reconstructed raw file carries beyond a normal one. */
export function reconstructedHeader(artifact, ref, cases) {
  return {
    generatedAt: artifact.generatedAt,
    labelHashes: labelHashes(cases),
    reconstructed: {
      from: `evals/results/${artifact.engine}.${artifact.datasetSplit}.json at commit ${ref} (per-case sampleDiagnostics.wrongFields / attemptsPerRun)`,
      method:
        'FM is deterministic (2/2 or 0/2 per case). A sample has a wrong field exactly when sampleDiagnostics lists it; its parse is the recorded actual for wrong fields and the label value for right ones.',
      lossy:
        'parse values for fields that were right are the labels at reconstruction time, not recorded model output; a future label change to a field that was right here cannot be re-scored exactly from this file.',
      reason: 're-baseline after h2 sign-label schema fix (amendment)',
      script: 'evals/reconstruct-raw.mjs',
    },
  };
}

export function readArtifactAt(ref, relPath) {
  return JSON.parse(execFileSync('git', ['show', `${ref}:${relPath}`], { cwd: REPO_ROOT, encoding: 'utf8' }));
}

function main() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const ref = arg('artifact-ref');
  const outDir = arg('out-dir');
  if (!ref || !outDir) {
    console.error('usage: node evals/reconstruct-raw.mjs --artifact-ref=<git-ref> --out-dir=<dir>');
    process.exit(2);
  }
  const artifact = readArtifactAt(ref, 'evals/results/fm.holdout2.json');
  const cases = loadCases(artifact.datasetSplit);
  const file = writeRaw({
    engine: artifact.engine,
    model: artifact.model,
    datasetSplit: artifact.datasetSplit,
    command: artifact.command,
    gitSha: artifact.gitSha,
    runs: reconstructRuns(artifact, cases),
    rawDir: path.resolve(outDir),
    extraHeader: reconstructedHeader(artifact, ref, cases),
  });
  console.log(`reconstruct-raw: wrote ${file}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
