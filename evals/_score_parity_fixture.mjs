/**
 * Shared fixture for `evals/test-score-parity.mjs` — one small dataset +
 * results set exercising every branch `score.mjs`/`scoring.py` both need to
 * agree on: a correct parse case, a wrong-field parse case, a correctly
 * refused refusal case, a false-positive refusal case, an unasserted-field
 * case, and (S4/review B2) a `status: 'error'` case on each population (parse
 * and refusal) — so the error-counts-as-a-failure rule (item 2) is covered by
 * the parity check too, not just each language's own unit tests.
 *
 * Plain data only (no functions) so it round-trips through JSON unchanged
 * for the Python side (`evals/_score_parity_helper.py`).
 */
export const CASES = [
  {
    id: 'ok-01',
    axis: 'plain',
    text: 'coffee 4.80',
    expected: {
      amountMinor: 480,
      sign: 'expense',
      dateISO: '2026-07-16',
      category: 'Dining',
      payee: null,
    },
  },
  {
    id: 'wrong-amount-01',
    axis: 'plain',
    text: 'coffee 4.80',
    expected: {
      amountMinor: 480,
      sign: 'expense',
      dateISO: '2026-07-16',
      category: null,
      payee: null,
    },
  },
  {
    id: 'refusal-ok-01',
    axis: 'fail-to-parse',
    text: 'gibberish',
    expected: null,
  },
  {
    id: 'refusal-false-positive-01',
    axis: 'fail-to-parse',
    text: 'gibberish',
    expected: null,
  },
  {
    id: 'unasserted-fields-01',
    axis: 'plain',
    text: 'spent 12 on parking',
    expected: {
      amountMinor: 1200,
      sign: 'expense',
      dateISO: '2026-07-16',
      category: null,
      payee: null,
    },
  },
  {
    id: 'error-parse-01',
    axis: 'plain',
    text: 'coffee 4.80',
    expected: {
      amountMinor: 480,
      sign: 'expense',
      dateISO: '2026-07-16',
      category: null,
      payee: null,
    },
  },
  {
    id: 'error-refusal-01',
    axis: 'fail-to-parse',
    text: 'gibberish',
    expected: null,
  },
];

export const RESULTS = {
  fixture: [
    {
      id: 'ok-01',
      status: 'ok',
      parse: {
        amount: 480,
        type: 'expense',
        occurredAt: 1784174400000,
        category: 'Dining',
        payee: 'Some Cafe',
      },
    },
    {
      id: 'wrong-amount-01',
      status: 'ok',
      parse: {
        amount: 1,
        type: 'expense',
        occurredAt: 1784174400000,
        category: 'Dining',
        payee: null,
      },
    },
    { id: 'refusal-ok-01', status: 'ok', parse: null },
    {
      id: 'refusal-false-positive-01',
      status: 'ok',
      parse: {
        amount: 100,
        type: 'expense',
        occurredAt: 1784174400000,
        category: 'Dining',
        payee: null,
      },
    },
    {
      id: 'unasserted-fields-01',
      status: 'ok',
      parse: {
        amount: 1200,
        type: 'expense',
        occurredAt: 1784174400000,
        category: 'Transport',
        payee: 'Some Lot',
      },
    },
    { id: 'error-parse-01', status: 'error', error: 'probe timed out', parse: null },
    { id: 'error-refusal-01', status: 'error', error: 'probe timed out', parse: null },
  ],
};
