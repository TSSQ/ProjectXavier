import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { resolveOnboardingComplete } from '../../src/domain/onboardingComplete';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/onboarding-complete-default.feature')
);

defineFeature(feature, (test) => {
  test('An unset preference resolves to not complete', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('no stored onboarding-complete value', () => {
      stored = null;
    });

    when('the onboarding-complete value is resolved', () => {
      result = resolveOnboardingComplete(stored);
    });

    then('onboarding should not be complete', () => {
      expect(result).toBe(false);
    });
  });

  test('A stored "1" value resolves to complete', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('a stored onboarding-complete value of "1"', () => {
      stored = '1';
    });

    when('the onboarding-complete value is resolved', () => {
      result = resolveOnboardingComplete(stored);
    });

    then('onboarding should be complete', () => {
      expect(result).toBe(true);
    });
  });

  test('A "0" or corrupt stored value resolves to not complete', ({
    given,
    when,
    then,
  }) => {
    let stored: string | null;
    let result: boolean;

    given(/^a stored onboarding-complete value of "(.*)"$/, (value: string) => {
      stored = value;
    });

    when('the onboarding-complete value is resolved', () => {
      result = resolveOnboardingComplete(stored);
    });

    then('onboarding should not be complete', () => {
      expect(result).toBe(false);
    });
  });
});
