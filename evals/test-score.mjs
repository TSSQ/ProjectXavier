#!/usr/bin/env node
/**
 * Unit tests for score.mjs (pure field comparison — no parse logic, so these
 * are plain, fast, offline assertions), mirroring `evals/test_scoring.py`'s
 * cases field-for-field so `score.mjs` is proven equal to `scoring.py`.
 *
 * Run: `node evals/test-score.mjs` (exits non-zero on any mismatch).
 */
import assert from 'node:assert/strict';
import { aggregate, normalizeName, scoreCase } from './score.mjs';

const TODAY_MS = 1784174400000; // 2026-07-16T12:00:00Z-ish epoch used in fixtures below
const YESTERDAY_MS = TODAY_MS - 86_400_000;

function expected(over = {}) {
  return {
    amountMinor: 1000,
    sign: 'expense',
    dateISO: '2026-07-16',
    category: 'Dining',
    payee: 'Subway',
    ...over,
  };
}

function parse(over = {}) {
  return {
    amount: 1000,
    type: 'expense',
    occurredAt: TODAY_MS,
    category: 'Dining',
    payee: 'Subway',
    ...over,
  };
}

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test('normalize_name_trims_collapses_lowercases', () => {
  assert.equal(normalizeName('  Fair  Price '), 'fair price');
  assert.equal(normalizeName(null), null);
});

test('all_fields_correct_scores_overall_true', () => {
  const scored = scoreCase(expected(), parse());
  assert.equal(scored.overall, true);
  assert.ok(Object.values(scored.fields).every(Boolean));
});

test('amount_mismatch_fails_only_amount_and_overall', () => {
  const scored = scoreCase(expected(), parse({ amount: 999 }));
  assert.equal(scored.fields.amountMinor, false);
  assert.equal(scored.fields.sign, true);
  assert.equal(scored.overall, false);
});

test('sign_mismatch', () => {
  const scored = scoreCase(expected({ sign: 'income' }), parse({ type: 'expense' }));
  assert.equal(scored.fields.sign, false);
  assert.equal(scored.overall, false);
});

test('category_normalized_match_ignores_case_and_whitespace', () => {
  const scored = scoreCase(
    expected({ category: 'fair price' }),
    parse({ category: '  Fair   Price  ' })
  );
  assert.equal(scored.fields.category, true);
});

test('category_unasserted_when_label_null', () => {
  // An unasserted (null-labeled) category is EXCLUDED from `fields`
  // entirely — it's not scored at all, so it can neither pass nor fail.
  const scored = scoreCase(expected({ category: null }), parse({ category: null }));
  assert.ok(!('category' in scored.fields));
});

test('category_model_proposal_ignored_when_label_null', () => {
  // (a) A real model proposing a non-null category against a null label is
  // IGNORED, not a fail: still excluded from `fields`, and `overall` is
  // unaffected by it (true here since every OTHER field matches).
  const scored = scoreCase(expected({ category: null }), parse({ category: 'Dining' }));
  assert.ok(!('category' in scored.fields));
  assert.equal(scored.overall, true);
});

test('category_mismatch_still_fails_when_label_asserts_it', () => {
  // (b) A wrong model category against a NON-null label still fails —
  // asserting a category means it's held to account.
  const scored = scoreCase(expected({ category: 'Dining' }), parse({ category: 'Groceries' }));
  assert.equal(scored.fields.category, false);
  assert.equal(scored.overall, false);
});

test('overall_ignores_unasserted_category_and_payee', () => {
  // (c) `overall` only reflects fields the label actually asserted — a case
  // with null category/payee labels passes on amount/sign/date alone, even
  // though the model's category/payee guesses don't match anything real
  // (there's nothing to compare them to).
  const scored = scoreCase(
    expected({ category: null, payee: null }),
    parse({ category: 'Groceries', payee: 'Nike' })
  );
  assert.ok(!('category' in scored.fields));
  assert.ok(!('payee' in scored.fields));
  assert.equal(scored.overall, true);
});

test('payee_normalized_match', () => {
  const scored = scoreCase(expected({ payee: 'subway' }), parse({ payee: 'Subway' }));
  assert.equal(scored.fields.payee, true);
});

test('payee_unasserted_when_label_null', () => {
  const scored = scoreCase(expected({ payee: null }), parse({ payee: 'FairPrice' }));
  assert.ok(!('payee' in scored.fields));
  assert.equal(scored.overall, true);
});

test('date_exact_match', () => {
  const scored = scoreCase(expected({ dateISO: '2026-07-16' }), parse({ occurredAt: TODAY_MS }));
  assert.equal(scored.fields.dateISO, true);
});

test('date_mismatch', () => {
  const scored = scoreCase(
    expected({ dateISO: '2026-07-16' }),
    parse({ occurredAt: YESTERDAY_MS })
  );
  assert.equal(scored.fields.dateISO, false);
});

test('date_both_null_matches', () => {
  const scored = scoreCase(expected({ dateISO: null }), parse({ occurredAt: null }));
  assert.equal(scored.fields.dateISO, true);
});

test('fail_to_parse_case_correct_when_engine_returns_null', () => {
  const scored = scoreCase(null, null);
  assert.equal(scored.failToParseCase, true);
  assert.equal(scored.correct, true);
  assert.equal(scored.overall, true);
});

test('fail_to_parse_case_incorrect_when_engine_returns_a_parse', () => {
  const scored = scoreCase(null, parse());
  assert.equal(scored.failToParseCase, true);
  assert.equal(scored.correct, false);
  assert.equal(scored.overall, false);
});

test('engine_returns_null_on_a_real_case_fails_every_field', () => {
  const scored = scoreCase(expected(), null);
  assert.equal(scored.failToParseCase, false);
  assert.ok(Object.values(scored.fields).every((v) => v === false));
  assert.equal(scored.overall, false);
});

test('null_parse_still_excludes_unasserted_optional_fields', () => {
  // Even when the engine returns nothing usable, an unasserted (null-label)
  // category/payee stays excluded rather than becoming an automatic fail —
  // only the objective fields (always asserted) count as misses here.
  const scored = scoreCase(expected({ category: null, payee: null }), null);
  assert.deepEqual(scored.fields, { amountMinor: false, sign: false, dateISO: false });
  assert.equal(scored.overall, false);
});

// ─── aggregate() ─────────────────────────────────────────────────────────────

const CASES = [
  { id: 'c1', text: 'coffee 4.80', expected: expected() },
  { id: 'c2', text: 'gibberish', expected: null },
];

test('aggregate_reports_skipped_engine', () => {
  const results = { openai: [{ id: 'c1', status: 'skipped', reason: 'no key', parse: null }] };
  const report = aggregate(CASES, results);
  assert.equal(report.openai.skipped, true);
  assert.equal(report.openai.reason, 'no key');
});

test('aggregate_computes_field_and_overall_accuracy', () => {
  const results = {
    heuristic: [
      { id: 'c1', status: 'ok', parse: parse() },
      { id: 'c2', status: 'ok', parse: null },
    ],
  };
  const report = aggregate(CASES, results).heuristic;
  assert.equal(report.skipped, false);
  assert.equal(report.fieldAccuracy.amountMinor, 1.0);
  assert.equal(report.overallAccuracy, 1.0);
  assert.equal(report.failToParseAccuracy, 1.0);
  assert.deepEqual(report.failures, []);
});

test('aggregate_records_failing_cases_with_diff', () => {
  const results = {
    heuristic: [
      { id: 'c1', status: 'ok', parse: parse({ amount: 1 }) },
      { id: 'c2', status: 'ok', parse: parse() }, // false positive on a fail-to-parse case
    ],
  };
  const report = aggregate(CASES, results).heuristic;
  assert.equal(report.overallAccuracy, 0.0);
  assert.equal(report.failToParseAccuracy, 0.0);
  const ids = new Set(report.failures.map((f) => f.id));
  assert.deepEqual(ids, new Set(['c1', 'c2']));
});

test('aggregate_separates_errors_from_scored_failures', () => {
  const results = {
    openai: [
      { id: 'c1', status: 'error', error: 'boom', parse: null },
      { id: 'c2', status: 'ok', parse: null },
    ],
  };
  const report = aggregate(CASES, results).openai;
  assert.deepEqual(report.errors, [{ id: 'c1', text: 'coffee 4.80', error: 'boom' }]);
  // c1 excluded from scored totals since it errored, not a scored miss.
  assert.equal(report.counts.overallTotal, 0);
  assert.equal(report.counts.failToParseTotal, 1);
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
