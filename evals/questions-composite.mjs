/**
 * The `composite` question engine (dev tooling — never ships; see
 * evals/README.md "Questions" → "Composite"). Measures a ROUTING POLICY, not a
 * model: "the floor when it answers, else <inner engine>" — the question order
 * `routeQueryEngines` (src/domain/parseRouter.ts) gives the app. Per case:
 *
 *   - the floor runs live (deterministic, free): when it serves a call, that
 *     call is the composite's answer, right or wrong — the inner engine never
 *     sees the question, exactly as in the app;
 *   - when the floor stands aside, the inner engine's row is used: read from
 *     its committed artifact (`results/questions.<inner>.<split>.json`, no
 *     model call) when that artifact was scored over the same labels, else
 *     run live (needs the key / the probe).
 *
 * An offline row carries the inner artifact's axes and pass exactly as it was
 * scored; if the question pipeline changed since that artifact
 * (`pipelineSha` differs) the composite says so in its `source` block —
 * naming the changed files when the artifact's commit is in the local git
 * history — rather than pretending the row is current. (`queryFloor.ts` is
 * one of the pipeline files, but an inner row is only used where the LIVE
 * floor stood aside, so a floor-only change leaves the inner rows current.)
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RESULTS_DIR = path.join(__dirname, 'results');

/** The engines a composite can put behind the floor. */
export const COMPOSITE_INNER_ENGINES = ['fm', 'anthropic', 'openai'];

/**
 * The committed artifact for `innerArtifactEngine` on `split`, usable for an
 * offline composite, or `{ artifact: null, reason }`. Usable means it exists
 * and was scored over exactly these labels (`datasetLabelSha`); a pipeline
 * change is reported (`pipelineShaMatches`), not hidden.
 */
export function loadInnerArtifact(innerArtifactEngine, split, { labelSha, pipelineSha, resultsDir = RESULTS_DIR }) {
  const file = path.join(resultsDir, `questions.${innerArtifactEngine}.${split}.json`);
  let artifact;
  try {
    artifact = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { artifact: null, file, reason: 'no committed artifact' };
  }
  if (artifact.datasetLabelSha !== labelSha) {
    return { artifact: null, file, reason: `labels changed since the artifact (${artifact.datasetLabelSha} ≠ ${labelSha})` };
  }
  return { artifact, file, pipelineShaMatches: artifact.pipelineSha === pipelineSha };
}

/**
 * The `files` whose text differs between commit `sha` and the working tree,
 * or null when that cannot be told (no such commit locally, e.g. a shallow
 * clone). Used to say WHICH part of the pipeline moved since an artifact.
 */
export function filesChangedSince(sha, files, repoRoot) {
  const changed = [];
  for (const rel of files) {
    let then;
    try {
      then = execFileSync('git', ['show', `${sha}:${rel}`], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return null;
    }
    let now;
    try {
      now = readFileSync(path.join(repoRoot, rel), 'utf8');
    } catch {
      now = null;
    }
    if (then !== now) changed.push(rel);
  }
  return changed;
}

/** An inner artifact's case entry as a runner row (`score` shaped like
 *  `scoreCase`'s, so the shared summary and report read it unchanged). */
export function rowFromArtifactCase(c, entry) {
  if (!entry) return { case: c, gate: null, status: 'error', error: 'case missing from the inner artifact', served: null };
  const row = { case: c, gate: entry.gate, status: entry.status, served: null };
  if (entry.status === 'error') return { ...row, error: entry.error ?? 'error' };
  return {
    ...row,
    pass: entry.pass,
    score: { axes: entry.axes, actual: entry.actual ?? null, pass: entry.pass },
  };
}

/**
 * One composite row: the floor's row when the floor served a call, else the
 * inner engine's. `servedBy` says which tier answered ('floor', the inner
 * engine, or null when neither served anything).
 */
export function compositeRow(floorRow, innerRow, innerEngine) {
  if (floorRow.served) return { ...floorRow, servedBy: 'floor' };
  const innerServed = innerRow.served ? true : Boolean(innerRow.score?.actual);
  return { ...innerRow, servedBy: innerServed ? innerEngine : null };
}
