import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { detectAccountIntent } from '../../src/domain/accountIntent';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-intent-ops.feature'));

/** Parses "<op> with hint "<hint>"" / "<op> with no hint" / "miss" and
 *  asserts against detectAccountIntent's result — mirrors account-
 *  intent.steps.ts's assertGateResult, extended for the `op` field. */
function assertGateResult(text: string, result: string): void {
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
  test('The op-discrimination collision set (spec §8 acceptance #2)', ({ then }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('"set up" (create) is not mistaken for an update via bare "set"', ({ then }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test("An account noun mentioned in an unrelated clause is NOT the op's target (QA MAJOR follow-up)", ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('"on" is NOT a clause preposition (QA recall-regression follow-up — "on" means "belonging to" as often as "regarding", and the latter is the REAL target)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('Rebalance-by-name (device-found gap) — set/change/update/adjust + balance + to + number, even with no account noun/name in ACCOUNT_NOUNS', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('Rebalance-by-name is a STRUCTURAL rule, not a clause-word blocklist (QA MAJOR B follow-up — the blocklist both under- and over-fired; a real conditional/subordinate clause must still miss, but a clause-shaped word inside the account NAME itself must not)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });
});
