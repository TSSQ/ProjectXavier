#!/usr/bin/env node
/**
 * Post hoc "refusal after intent routing" and per-refusal-subtype figures
 * from an EXISTING results artifact — for artifacts that predate
 * `afterRoutingRefusal` / `extendedMetrics.refusalBySubtype` (evals/results/
 * fm.json). Never runs an engine: it reads the artifact's per-case
 * `passes`/`samples`, scores a refusal case "reliable" at
 * `passes/samples >= perCaseThreshold` (1.0 for a single-sample artifact),
 * and asks the real `detectIntent` (evals/fm/intent-routing.mjs, a tsx
 * subprocess, no model involved) which refusal cases route away.
 *
 * Usage: node evals/post-hoc-refusal.mjs [evals/results/fm.json]
 * Sanity check: on openai.json the output must equal the artifact's own
 * recorded `afterRoutingRefusal` / `extendedMetrics.refusalBySubtype`.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCases } from './split.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

/** Pure: figures from the artifact's per-case rows + routed id set. */
export function computePostHoc(artifact, cases, routedIds) {
  const threshold = artifact.perCaseThreshold ?? 1;
  const byId = new Map(artifact.cases.map((c) => [c.id, c]));
  const reliable = (id) => {
    const row = byId.get(id);
    if (!row) throw new Error(`artifact has no row for case ${id}`);
    return row.passes / row.samples >= threshold;
  };
  const after = { correct: 0, total: 0, routed: 0 };
  const bySubtype = {};
  for (const c of cases.filter((x) => x.expected == null)) {
    const key = c.subtype ?? 'unspecified';
    bySubtype[key] ??= { correct: 0, total: 0 };
    bySubtype[key].total += 1;
    if (reliable(c.id)) bySubtype[key].correct += 1;
    if (routedIds.has(c.id)) {
      after.routed += 1;
      continue;
    }
    after.total += 1;
    if (reliable(c.id)) after.correct += 1;
  }
  return {
    afterRoutingRefusal: { ...after, rate: after.total ? after.correct / after.total : null },
    refusalBySubtype: Object.fromEntries(Object.entries(bySubtype).sort(([a], [b]) => a.localeCompare(b))),
  };
}

function routedIdsFor(cases) {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'xavier-posthoc-'));
  try {
    const p = path.join(tmpDir, 'refusals.jsonl');
    writeFileSync(p, cases.filter((c) => c.expected == null).map((c) => JSON.stringify(c)).join('\n') + '\n');
    const out = execFileSync('npx', ['tsx', path.join(__dirname, 'fm', 'intent-routing.mjs'), p], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
    });
    return new Set(JSON.parse(out).filter((r) => r.routed).map((r) => r.id));
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const artifactPath = process.argv[2] ?? path.join(__dirname, 'results', 'fm.json');
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  const cases = loadCases(artifact.datasetSplit);
  console.log(JSON.stringify(computePostHoc(artifact, cases, routedIdsFor(cases)), null, 2));
}
