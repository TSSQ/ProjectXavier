import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { detectTransactionOpCandidate } from '../../src/domain/transactionOpIntent';
import { detectAccountIntent } from '../../src/domain/accountIntent';

const feature = loadFeature(path.resolve(__dirname, '../__features__/transaction-op-intent.feature'));

function assertCandidateResult(text: string, expected: string): void {
  const candidate = detectTransactionOpCandidate(text);
  if (expected === 'miss') {
    expect(candidate).toBeNull();
    return;
  }
  expect(candidate).not.toBeNull();
  expect(candidate?.verbCategory).toBe(expected);
}

/** Mirrors account-intent-ops.steps.ts's assertGateResult — kept local
 *  (self-contained per this codebase's convention: no shared step library
 *  across .steps.ts files) rather than imported. */
function assertAccountGateResult(text: string, result: string): void {
  const intent = detectAccountIntent(text);
  if (result === 'miss') {
    expect(intent).toBeNull();
    return;
  }
  const hintMatch = /^(create|update|delete) with hint "(.*)"$/.exec(result);
  const noHintMatch = /^(create|update|delete) with no hint$/.exec(result);
  if (hintMatch) {
    expect(intent).not.toBeNull();
    expect(intent?.op).toBe(hintMatch[1]);
    expect(intent?.subtypeHint).toBe(hintMatch[2]);
  } else if (noHintMatch) {
    expect(intent).not.toBeNull();
    expect(intent?.op).toBe(noHintMatch[1]);
    expect(intent?.subtypeHint).toBeUndefined();
  } else {
    throw new Error(`Unrecognised expected result "${result}" in feature table`);
  }
}

defineFeature(feature, (test) => {
  test('A mutation verb + reference is a candidate, classified into the right floor verb category', ({
    then,
  }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should be "(.*)"$/, assertCandidateResult);
  });

  test('Missing verb or missing reference is never a candidate', ({ then }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should miss$/, (text: string) => {
      assertCandidateResult(text, 'miss');
    });
  });

  test('Veto 1 — a bare stated amount with no reference at all is a new expense, not a candidate', ({
    then,
  }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should miss$/, (text: string) => {
      assertCandidateResult(text, 'miss');
    });
  });

  test('Veto 1 does not fire when a date phrase supplies the reference', ({ then }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should be "(.*)"$/, assertCandidateResult);
  });

  test("Veto 1's false-positive guard — a bare pronoun right after a conditional clause word is not a reference", ({
    then,
  }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should miss$/, (text: string) => {
      assertCandidateResult(text, 'miss');
    });
  });

  test('Veto 2 — bulk requests are refused, never a candidate', ({ then }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should miss$/, (text: string) => {
      assertCandidateResult(text, 'miss');
    });
  });

  test('Prompt injection cannot change the deterministic classification', ({ then }) => {
    then(/^detecting a transaction-op candidate in "(.*)" should be "(.*)"$/, assertCandidateResult);
  });

  test("The §5.1.1 collision — a ledger noun before the account noun makes it a location qualifier, not the account gate's target", ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should miss$/, (text: string) => {
      assertAccountGateResult(text, 'miss');
    });
    then(/^detecting a transaction-op candidate in "(.*)" should be "(.*)"$/, assertCandidateResult);
  });

  test("The §5.1.1 fix does not regress the account gate's own recall", ({ then }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertAccountGateResult);
  });
});
