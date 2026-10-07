#!/usr/bin/env node
/**
 * Dev-split guard for the budget-command router: it must route NO case whose
 * expected label is a transaction (a real spend answered with a budget card is
 * a costly hijack), and the model-fallback trigger must not fire on one either.
 * Dev only; no model, no network.
 *
 * Run: `node evals/test-budget-routes.mjs`
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = execFileSync('npx', ['tsx', path.join(ROOT, 'evals', 'fm', 'budget-hits.mjs'), '--json'], {
  encoding: 'utf8',
  cwd: ROOT,
  maxBuffer: 8 * 1024 * 1024,
});
const r = JSON.parse(out.trim().split('\n').pop());

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('budget_routes_fire_on_no_dev_transaction', () => {
  assert.deepEqual(r.falsePositives, []);
});

test('the_dev_split_was_actually_read', () => {
  assert.ok(r.cases >= 200, `expected the dev split, got ${r.cases}`);
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
