#!/usr/bin/env node
/**
 * Tests for the offline comparison tools: post-hoc-refusal.mjs (scores only
 * the ids an artifact holds) and paired.mjs (exact McNemar between two raw
 * files). No model, no network, no tsx subprocess.
 *
 * Run: `node evals/test-paired.mjs`
 */
import assert from 'node:assert/strict';
import { restrictToArtifact, computePostHoc } from './post-hoc-refusal.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ─── post-hoc-refusal ───────────────────────────────────────────────────────

const refusal = (id, subtype) => ({ id, axis: 'fail-to-parse', subtype, expected: null });
const parseCase = (id) => ({ id, axis: 'plain', expected: { amountMinor: 1, sign: 'expense', dateISO: '2026-01-01', category: null, payee: null } });

test('post_hoc_scores_only_the_ids_the_artifact_holds_and_reports_the_skipped', () => {
  const artifact = {
    perCaseThreshold: 1,
    cases: [
      { id: 'r1', passes: 1, samples: 1 },
      { id: 'r2', passes: 0, samples: 1 },
      { id: 'p1', passes: 1, samples: 1 },
    ],
  };
  // r3 and p2 are newer than the artifact (it was measured on an older, smaller dataset).
  const current = [refusal('r1', 'gibberish'), refusal('r2', 'gibberish'), refusal('r3', 'gibberish'), parseCase('p1'), parseCase('p2')];
  const { cases, skipped } = restrictToArtifact(artifact, current);
  assert.deepEqual(skipped, ['r3', 'p2']);
  assert.deepEqual(cases.map((c) => c.id), ['r1', 'r2', 'p1']);
  // The unrestricted call is the crash the CLI used to hit.
  assert.throws(() => computePostHoc(artifact, current, new Set()), /no row for case r3/);
  const out = computePostHoc(artifact, cases, new Set(['r2']));
  assert.deepEqual(out.afterRoutingRefusal, { correct: 1, total: 1, routed: 1, rate: 1 });
  assert.deepEqual(out.refusalBySubtype, { gibberish: { correct: 1, total: 2 } });
});

test('post_hoc_skips_nothing_when_the_artifact_holds_every_current_case', () => {
  const artifact = { cases: [{ id: 'r1', passes: 1, samples: 1 }] };
  const { cases, skipped } = restrictToArtifact(artifact, [refusal('r1', 'x')]);
  assert.equal(cases.length, 1);
  assert.deepEqual(skipped, []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
