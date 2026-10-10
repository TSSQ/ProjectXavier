#!/usr/bin/env node
/**
 * Dev-split guard for the sign reader and the transaction affirmation
 * (src/domain/signReader.ts, src/domain/fmRefusal.ts): the reader must never
 * contradict a dev label (it decides only where the words are unambiguous), a
 * model `transfer` on a labelled transfer must survive `resolveSign`, and the
 * affirmation must fire on NO dev refusal case (a false log is the costly
 * error) while still covering most dev spends. Dev only; no model, no network.
 *
 * Run: `node evals/test-sign.mjs`
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = execFileSync('npx', ['tsx', path.join(ROOT, 'evals', 'fm', 'sign-hits.mjs'), '--json'], {
  encoding: 'utf8',
  cwd: ROOT,
  maxBuffer: 8 * 1024 * 1024,
});
const r = JSON.parse(out.trim().split('\n').pop());

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('sign_reader_contradicts_no_dev_label', () => {
  assert.deepEqual(r.signWrong, []);
});

test('sign_reader_decides_a_real_share_of_dev_spends', () => {
  assert.ok(r.parseCases >= 190, `expected the dev parse set, got ${r.parseCases}`);
  assert.ok(r.decided / r.parseCases >= 0.4, `decided ${r.decided}/${r.parseCases}`);
});

test('resolveSign_keeps_every_labelled_transfer_the_model_called_a_transfer', () => {
  assert.deepEqual(r.demotedTransfers, []);
});

test('affirmation_fires_on_no_dev_refusal', () => {
  assert.deepEqual(r.affirmedRefusals, []);
});

test('affirmation_would_keep_most_dev_spends_the_model_refused', () => {
  assert.ok(r.affirmedSpends / r.parseCases >= 0.8, `affirmed ${r.affirmedSpends}/${r.parseCases}`);
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
