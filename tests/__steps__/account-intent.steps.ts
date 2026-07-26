import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { detectAccountIntent } from '../../src/domain/accountIntent';

const feature = loadFeature(path.resolve(__dirname, '../__features__/account-intent.feature'));

/** Shared "hit with hint X" / "hit with no hint" / "miss" assertion for the
 *  outline scenarios below — factored out so each `test()` block
 *  (jest-cucumber scopes step definitions per scenario) applies the exact
 *  same check. Any result string outside these three shapes is a typo in the
 *  feature file, not a valid miss — fail loudly rather than silently
 *  asserting the wrong thing. */
function assertGateResult(text: string, result: string): void {
  const intent = detectAccountIntent(text);
  const hitMatch = /^hit with hint "(.*)"$/.exec(result);
  if (hitMatch) {
    expect(intent).not.toBeNull();
    expect(intent?.subtypeHint).toBe(hitMatch[1]);
  } else if (result === 'hit with no hint') {
    expect(intent).not.toBeNull();
    expect(intent?.subtypeHint).toBeUndefined();
  } else if (result === 'miss') {
    expect(intent).toBeNull();
  } else {
    throw new Error(`Unrecognised expected result "${result}" in feature table`);
  }
}

defineFeature(feature, (test) => {
  test('The collision test set (spec §8 acceptance #1)', ({ then }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('The government-rule collision set (QA follow-up on the "new" bypass + possessive leak)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('Bare "new" is anchored to the start of the utterance (QA follow-up — merely REFERENCING an existing "new X" must not hit)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('The forward guard applies to EVERY creation verb, not just bare "new" (reviewer follow-up — attributive noun use must not hijack an expense)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('"named"/"called"/"ending" introduce the account\'s own name/description, not a different head noun (reviewer recall follow-up)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('"at"/"in"/"of" are deliberately NOT added as allowed trailing words — accepted MISS (reviewer follow-up)', ({
    then,
  }) => {
    then(/^detecting account intent in "(.*)" should (.*)$/, assertGateResult);
  });

  test('A generic "account" noun hits with no subtype hint', ({ then }) => {
    then(/^detecting account intent in "(.*)" should hit with no hint$/, (text: string) => {
      const intent = detectAccountIntent(text);
      expect(intent).not.toBeNull();
      expect(intent?.subtypeHint).toBeUndefined();
    });
  });

  test('"new account:" and "add account" lead-ins both hit', ({ then, and }) => {
    const expectHitNoHint = (text: string) => {
      const intent = detectAccountIntent(text);
      expect(intent).not.toBeNull();
      expect(intent?.subtypeHint).toBeUndefined();
    };
    then(/^detecting account intent in "(.*)" should hit with no hint$/, expectHitNoHint);
    and(/^detecting account intent in "(.*)" should hit with no hint$/, expectHitNoHint);
  });
});
