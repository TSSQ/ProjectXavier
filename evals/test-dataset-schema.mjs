#!/usr/bin/env node
/**
 * Schema test over every committed dataset case (see dataset-schema.mjs for
 * why). Fails on a label with a missing field — e.g. an `expected` without
 * `sign`, the bug that invalidated the first holdout-v2 baselines.
 *
 * Run: `node evals/test-dataset-schema.mjs` (exits non-zero on any failure).
 */
import assert from 'node:assert/strict';
import { loadRawCases } from './split.mjs';
import { validateCases } from './dataset-schema.mjs';

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

const good = {
  id: 'x-1',
  axis: 'plain',
  split: 'dev',
  text: 'coffee 5',
  context: { categories: [] },
  expected: { amountMinor: 500, sign: 'expense', dateISO: '2026-10-02', category: null, payee: null },
};

test('every_committed_case_has_a_complete_label', () => {
  const problems = validateCases(loadRawCases());
  assert.deepEqual(
    problems.map((p) => `${p.id}: ${p.issues.join('; ')}`),
    []
  );
});

test('a_complete_parse_case_is_valid', () => {
  assert.deepEqual(validateCases([good]), []);
});

test('missing_sign_is_rejected', () => {
  const { sign: _sign, ...noSign } = good.expected;
  const problems = validateCases([{ ...good, expected: noSign }]);
  assert.equal(problems.length, 1);
  assert.match(problems[0].issues.join(), /expected\.sign/);
});

test('each_other_missing_or_bad_expected_field_is_rejected', () => {
  for (const [key, bad] of [
    ['amountMinor', undefined],
    ['amountMinor', 0],
    ['amountMinor', 1.5],
    ['sign', 'refund'],
    ['dateISO', undefined],
    ['dateISO', '2026-1-2'],
    ['category', undefined],
    ['payee', undefined],
  ]) {
    const expected = { ...good.expected };
    if (bad === undefined) delete expected[key];
    else expected[key] = bad;
    assert.equal(validateCases([{ ...good, expected }]).length, 1, `${key}=${bad}`);
  }
});

test('required_top_level_fields_are_enforced', () => {
  for (const key of ['id', 'axis', 'text', 'context', 'split']) {
    const c = { ...good };
    delete c[key];
    assert.ok(validateCases([c]).length >= 1, key);
  }
});

test('a_refusal_needs_a_subtype', () => {
  const refusal = { ...good, expected: null };
  assert.equal(validateCases([refusal]).length, 1);
  assert.deepEqual(validateCases([{ ...refusal, subtype: 'gibberish' }]), []);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed += 1;
    console.error(`  FAIL ${name}\n       ${e.message.split('\n').join('\n       ')}`);
  }
}
console.log(`\ntest-dataset-schema: ${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
