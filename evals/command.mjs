/**
 * The human-readable `command` string recorded in every results artifact and
 * holdout-looks.json entry. Lives in its own module so tests can import it
 * without importing run-eval.mjs (which loads .env and runs main()).
 */

/** Human-readable command string recorded in the artifact for
 *  reproducibility.
 *
 *  REVIEW X1 FIX: `--split=<datasetSplit>` is now ALWAYS included, even for
 *  the default `'all'`/(the now-default) `'dev'` — previously this only
 *  appended the flag when `datasetSplit !== 'all'`, so a run that actually
 *  used the (now-default) `--split=dev` had it silently OMITTED from the
 *  recorded `command` whenever a caller passed the old `'all'` default
 *  through, making the committed artifact's own `command` string
 *  unreproducible/misleading about which population it actually scored.
 *  There is no "default split that doesn't need stating" any more — every
 *  recorded command states its split explicitly.
 *
 *  For a `'holdout'`/`'all'` run (the two splits `guardAndLogHoldoutLook`
 *  gates), `--confirm-holdout --purpose="..."` is also included whenever
 *  `purpose` is available — the exact flags that run actually needed to
 *  pass the guard, so the recorded command is a faithful, copy-pasteable
 *  reproduction, not merely the base invocation. */
export function commandFor(engine, n, datasetSplit, { purpose } = {}) {
  const splitFlag = ` --split=${datasetSplit}`;
  const holdoutFlags =
    (datasetSplit === 'holdout' || datasetSplit === 'all') && purpose
      ? ` --confirm-holdout --purpose="${purpose}"`
      : '';
  // npm only forwards flags to the script after a bare `--`; without it
  // `npm run eval:openai --split=all` silently drops them.
  // Review L1: `--n` is recorded for every engine that goes through
  // `runNTimes` (everything but the heuristic, which ignores it).
  const nFlag = n > 1 ? ` --n=${n}` : '';
  if (engine === 'heuristic') return `npm run eval --${splitFlag}${holdoutFlags}`;
  if (engine === 'anthropic') return `npm run eval:cloud --${nFlag}${splitFlag}${holdoutFlags}`;
  if (engine === 'openai') return `npm run eval:openai --${nFlag}${splitFlag}${holdoutFlags}`;
  if (engine === 'fm') {
    return `FM_PROBE_PATH=$PWD/evals/fm/probe node evals/run-eval.mjs --engine=fm --n=${n}${splitFlag}${holdoutFlags}`;
  }
  return `node evals/run-eval.mjs --engine=${engine}${nFlag}${splitFlag}${holdoutFlags}`;
}
