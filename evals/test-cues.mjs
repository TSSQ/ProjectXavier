#!/usr/bin/env node
/**
 * Dev-split guard for the not-a-transaction cue check: it must fire on NO case
 * whose expected label is a transaction (a false refusal of a real expense is
 * the costly error), and it must catch most of the dev near-miss refusals (so a
 * broken regex that never fires cannot pass). Dev only; no model, no network.
 *
 * Run: `node evals/test-cues.mjs`
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = execFileSync('npx', ['tsx', path.join(ROOT, 'evals', 'fm', 'cue-hits.mjs'), '--json'], {
  encoding: 'utf8',
  cwd: ROOT,
  maxBuffer: 8 * 1024 * 1024,
});
const r = JSON.parse(out.trim().split('\n').pop());

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('cues_fire_on_no_dev_transaction', () => {
  assert.deepEqual(r.falsePositives, []);
});

test('cues_catch_most_dev_near_miss_refusals', () => {
  const nm = r.bySubtype['finance-near-miss'];
  assert.ok(nm.total >= 50, `expected the dev near-miss set, got ${nm.total}`);
  assert.ok(nm.hits / nm.total >= 0.85, `cue hit rate ${nm.hits}/${nm.total}`);
});

test('cues_do_not_fire_on_gibberish_or_off_topic_refusals', () => {
  for (const st of ['gibberish', 'off-topic', 'injection']) {
    assert.equal(r.bySubtype[st].hits, 0, st);
  }
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
