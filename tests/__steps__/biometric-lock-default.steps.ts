import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { resolveBiometricLock } from '../../src/domain/biometricLock';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/biometric-lock-default.feature')
);

defineFeature(feature, (test) => {
  test('An unset preference resolves to off', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('no stored biometric-lock preference', () => {
      stored = null;
    });

    when('the biometric-lock preference is resolved', () => {
      result = resolveBiometricLock(stored);
    });

    then('the biometric lock should be off', () => {
      expect(result).toBe(false);
    });
  });

  test('A stored "on" preference resolves to on', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('a stored biometric-lock preference of "1"', () => {
      stored = '1';
    });

    when('the biometric-lock preference is resolved', () => {
      result = resolveBiometricLock(stored);
    });

    then('the biometric lock should be on', () => {
      expect(result).toBe(true);
    });
  });

  test('A stored "off" preference resolves to off', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('a stored biometric-lock preference of "0"', () => {
      stored = '0';
    });

    when('the biometric-lock preference is resolved', () => {
      result = resolveBiometricLock(stored);
    });

    then('the biometric lock should be off', () => {
      expect(result).toBe(false);
    });
  });

  test('An arbitrary or corrupt stored value resolves to off', ({
    given,
    when,
    then,
  }) => {
    let stored: string | null;
    let result: boolean;

    given(/^a stored biometric-lock preference of "(.*)"$/, (value: string) => {
      stored = value;
    });

    when('the biometric-lock preference is resolved', () => {
      result = resolveBiometricLock(stored);
    });

    then('the biometric lock should be off', () => {
      expect(result).toBe(false);
    });
  });
});
