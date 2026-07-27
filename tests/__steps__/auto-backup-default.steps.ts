import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import { resolveAutoBackupEnabled } from '../../src/domain/backupPolicy';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/auto-backup-default.feature')
);

defineFeature(feature, (test) => {
  test('An unset preference resolves to on', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('no stored auto-backup preference', () => {
      stored = null;
    });

    when('the auto-backup preference is resolved', () => {
      result = resolveAutoBackupEnabled(stored);
    });

    then('auto-backup should be on', () => {
      expect(result).toBe(true);
    });
  });

  test('A stored "on" preference resolves to on', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('a stored auto-backup preference of "1"', () => {
      stored = '1';
    });

    when('the auto-backup preference is resolved', () => {
      result = resolveAutoBackupEnabled(stored);
    });

    then('auto-backup should be on', () => {
      expect(result).toBe(true);
    });
  });

  test('A stored "off" preference resolves to off', ({ given, when, then }) => {
    let stored: string | null;
    let result: boolean;

    given('a stored auto-backup preference of "0"', () => {
      stored = '0';
    });

    when('the auto-backup preference is resolved', () => {
      result = resolveAutoBackupEnabled(stored);
    });

    then('auto-backup should be off', () => {
      expect(result).toBe(false);
    });
  });

  test('An undefined preference resolves to on', ({ given, when, then }) => {
    let stored: string | undefined;
    let result: boolean;

    given('an undefined auto-backup preference', () => {
      stored = undefined;
    });

    when('the auto-backup preference is resolved', () => {
      result = resolveAutoBackupEnabled(stored);
    });

    then('auto-backup should be on', () => {
      expect(result).toBe(true);
    });
  });
});
