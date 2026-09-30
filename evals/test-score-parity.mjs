#!/usr/bin/env node
/**
 * Differential test (review S4 — "scorer lockstep"): feeds the SAME fixture
 * (`evals/_score_parity_fixture.mjs`) through `score.mjs`'s `aggregate()` and
 * `scoring.py`'s `aggregate()` (via `evals/_score_parity_helper.py`, a thin
 * subprocess wrapper — no re-implementation on either side) and fails on ANY
 * numeric difference between the two reports.
 *
 * `evals/test-score.mjs` and `evals/test_scoring.py` already mirror each
 * other's unit-test CASES by hand — proven equal only in the sense that a
 * human kept both files in sync. This test instead runs both real
 * `aggregate()` implementations on one shared input and diffs their actual
 * output, so a hand-sync slip (a case added to one file but not the other,
 * or a subtle floating-point/rounding difference) shows up here even if both
 * files' own hand-written assertions still individually pass.
 *
 * Skips (prints a message, exits 0) when `evals/.venv` doesn't exist — same
 * policy as the rest of the Python-side tooling (see README "Install"): the
 * JS gate (`npm run eval`) never requires a Python venv.
 *
 * Run: `node evals/test-score-parity.mjs` — also run as part of `npm run
 * eval` (see run-eval.mjs), after `evals/test-score.mjs`, before scoring.
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregate } from './score.mjs';
import { CASES, RESULTS } from './_score_parity_fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENV_PYTHON = path.join(__dirname, '.venv', 'bin', 'python');
const HELPER_PATH = path.join(__dirname, '_score_parity_helper.py');

function main() {
  if (!existsSync(VENV_PYTHON)) {
    console.log(
      'test-score-parity: SKIPPED — evals/.venv not found (see README "Install"); ' +
        'the JS gate never requires a Python venv, but the parity check needs one to run scoring.py.'
    );
    process.exit(0);
  }

  const jsReport = aggregate(CASES, RESULTS);

  const proc = spawnSync(VENV_PYTHON, [HELPER_PATH], {
    cwd: __dirname,
    input: JSON.stringify({ cases: CASES, results: RESULTS }),
    encoding: 'utf8',
  });
  if (proc.status !== 0) {
    console.error('test-score-parity: FAILED — scoring.py helper errored:');
    console.error(proc.stderr || proc.stdout);
    process.exit(1);
  }

  let pyReport;
  try {
    pyReport = JSON.parse(proc.stdout);
  } catch (e) {
    console.error(`test-score-parity: FAILED — could not parse scoring.py helper output: ${e.message}`);
    console.error(proc.stdout);
    process.exit(1);
  }

  const jsJson = JSON.stringify(jsReport.fixture, null, 2);
  const pyJson = JSON.stringify(pyReport.fixture, null, 2);

  if (jsJson !== pyJson) {
    console.error('test-score-parity: FAILED — score.mjs and scoring.py disagree on the same fixture.\n');
    console.error('score.mjs (JS):');
    console.error(jsJson);
    console.error('\nscoring.py (Python):');
    console.error(pyJson);
    process.exit(1);
  }

  console.log('test-score-parity: PASS — score.mjs and scoring.py agree on the fixture.');
  process.exit(0);
}

main();
