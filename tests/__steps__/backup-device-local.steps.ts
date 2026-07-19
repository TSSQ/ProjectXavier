import path from 'path';
import { defineFeature, loadFeature } from 'jest-cucumber';
import {
  DEVICE_LOCAL_SETTINGS_KEYS,
  SETTINGS_EXCLUDED_FROM_BACKUP,
  BACKUP_BOOKKEEPING_SETTINGS_KEYS,
  settingsForRestore,
  settingsForBackup,
} from '../../src/domain/backupPolicy';

const feature = loadFeature(
  path.resolve(__dirname, '../__features__/backup-device-local.feature')
);

defineFeature(feature, (test) => {
  test('The exclusion lists contain exactly the right keys', ({ then, and }) => {
    then(
      /^DEVICE_LOCAL_SETTINGS_KEYS should contain biometric_lock, backup_auto_enabled, theme, onboarding_complete, and selftransfer_scan_ack$/,
      () => {
        expect(DEVICE_LOCAL_SETTINGS_KEYS).toEqual(
          expect.arrayContaining([
            'biometric_lock',
            'backup_auto_enabled',
            'theme',
            'onboarding_complete',
            'selftransfer_scan_ack',
          ]),
        );
        expect(DEVICE_LOCAL_SETTINGS_KEYS).toHaveLength(5);
      },
    );

    and(
      /^SETTINGS_EXCLUDED_FROM_BACKUP should contain the bookkeeping and device-local keys$/,
      () => {
        for (const key of BACKUP_BOOKKEEPING_SETTINGS_KEYS) {
          expect(SETTINGS_EXCLUDED_FROM_BACKUP).toContain(key);
        }
        for (const key of DEVICE_LOCAL_SETTINGS_KEYS) {
          expect(SETTINGS_EXCLUDED_FROM_BACKUP).toContain(key);
        }
        expect(SETTINGS_EXCLUDED_FROM_BACKUP).toHaveLength(
          BACKUP_BOOKKEEPING_SETTINGS_KEYS.length + DEVICE_LOCAL_SETTINGS_KEYS.length,
        );
      },
    );
  });

  test('settingsForRestore drops device-local keys but keeps user data', ({
    given,
    when,
    then,
    and,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with biometric_lock, backup_auto_enabled, theme, currency, avatar_look, and avatar_kind$/,
      () => {
        input = {
          biometric_lock: '1',
          backup_auto_enabled: '1',
          theme: 'dark',
          currency: 'SGD',
          avatar_look: 'mint',
          avatar_kind: 'blob',
        };
      },
    );

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(
      /^the result should not contain biometric_lock, backup_auto_enabled, or theme$/,
      () => {
        expect(result).not.toHaveProperty('biometric_lock');
        expect(result).not.toHaveProperty('backup_auto_enabled');
        expect(result).not.toHaveProperty('theme');
      },
    );

    and(/^the result should still contain currency, avatar_look, and avatar_kind$/, () => {
      expect(result).toEqual({
        currency: 'SGD',
        avatar_look: 'mint',
        avatar_kind: 'blob',
      });
    });
  });

  test("Restoring a backup with biometric_lock='1' does not carry it onto the device", ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(/^a settings map with biometric_lock set to "(.*)"$/, (value: string) => {
      input = { biometric_lock: value };
    });

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(/^the result should not contain biometric_lock$/, () => {
      expect(result).not.toHaveProperty('biometric_lock');
    });
  });

  test('An empty settings map filters to an empty map', ({ given, when, then }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(/^an empty settings map$/, () => {
      input = {};
    });

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(/^the result should be an empty map$/, () => {
      expect(result).toEqual({});
    });
  });

  test('settingsForBackup drops bookkeeping and device-local keys but keeps user data', ({
    given,
    when,
    then,
    and,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with backup_last_sig, backup_last_at, biometric_lock, backup_auto_enabled, theme, currency, avatar_look, and avatar_kind$/,
      () => {
        input = {
          backup_last_sig: 'sig-1',
          backup_last_at: '1700000000000',
          biometric_lock: '1',
          backup_auto_enabled: '1',
          theme: 'dark',
          currency: 'SGD',
          avatar_look: 'mint',
          avatar_kind: 'blob',
        };
      },
    );

    when(/^I filter it with settingsForBackup$/, () => {
      result = settingsForBackup(input);
    });

    then(/^the backup result should not contain any excluded key$/, () => {
      for (const key of SETTINGS_EXCLUDED_FROM_BACKUP) {
        expect(result).not.toHaveProperty(key);
      }
    });

    and(/^the backup result should still contain currency, avatar_look, and avatar_kind$/, () => {
      expect(result).toEqual({
        currency: 'SGD',
        avatar_look: 'mint',
        avatar_kind: 'blob',
      });
    });
  });

  test('An empty settings map filters to an empty map for the backup direction', ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(/^an empty settings map$/, () => {
      input = {};
    });

    when(/^I filter it with settingsForBackup$/, () => {
      result = settingsForBackup(input);
    });

    then(/^the result should be an empty map$/, () => {
      expect(result).toEqual({});
    });
  });

  test('An unrelated future key survives settingsForRestore unchanged', ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with an unrelated notification_pref key, biometric_lock, and currency$/,
      () => {
        input = {
          notification_pref: 'daily',
          biometric_lock: '1',
          currency: 'EUR',
        };
      },
    );

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(/^the result should equal notification_pref daily and currency EUR only$/, () => {
      expect(result).toEqual({ notification_pref: 'daily', currency: 'EUR' });
    });
  });

  test('An unrelated future key survives settingsForBackup unchanged', ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with an unrelated notification_pref key, a bookkeeping key, biometric_lock, and currency$/,
      () => {
        input = {
          notification_pref: 'daily',
          backup_last_sig: 'sig-1',
          biometric_lock: '1',
          currency: 'EUR',
        };
      },
    );

    when(/^I filter it with settingsForBackup$/, () => {
      result = settingsForBackup(input);
    });

    then(/^the result should equal notification_pref daily and currency EUR only$/, () => {
      expect(result).toEqual({ notification_pref: 'daily', currency: 'EUR' });
    });
  });

  test('onboarding_complete is excluded from a new backup (gather-strip direction)', ({
    given,
    when,
    then,
    and,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with onboarding_complete, currency, and avatar_look$/,
      () => {
        input = {
          onboarding_complete: '1',
          currency: 'SGD',
          avatar_look: 'mint',
        };
      },
    );

    when(/^I filter it with settingsForBackup$/, () => {
      result = settingsForBackup(input);
    });

    then(/^the backup result should not contain onboarding_complete$/, () => {
      expect(result).not.toHaveProperty('onboarding_complete');
    });

    and(/^the result should equal currency SGD and avatar_look mint only$/, () => {
      expect(result).toEqual({ currency: 'SGD', avatar_look: 'mint' });
    });
  });

  test('onboarding_complete is dropped on restore, not carried onto the device (apply-skip direction)', ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(/^a settings map with onboarding_complete set to "(.*)"$/, (value: string) => {
      input = { onboarding_complete: value };
    });

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(/^the result should not contain onboarding_complete$/, () => {
      expect(result).not.toHaveProperty('onboarding_complete');
    });
  });

  test('selftransfer_scan_ack is excluded from a new backup (gather-strip direction)', ({
    given,
    when,
    then,
    and,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(
      /^a settings map with selftransfer_scan_ack, currency, and avatar_look$/,
      () => {
        input = {
          selftransfer_scan_ack: '1',
          currency: 'SGD',
          avatar_look: 'mint',
        };
      },
    );

    when(/^I filter it with settingsForBackup$/, () => {
      result = settingsForBackup(input);
    });

    then(/^the backup result should not contain selftransfer_scan_ack$/, () => {
      expect(result).not.toHaveProperty('selftransfer_scan_ack');
    });

    and(/^the result should equal currency SGD and avatar_look mint only$/, () => {
      expect(result).toEqual({ currency: 'SGD', avatar_look: 'mint' });
    });
  });

  test('selftransfer_scan_ack is dropped on restore, not carried onto a fresh device (apply-skip direction)', ({
    given,
    when,
    then,
  }) => {
    let input: Record<string, string>;
    let result: Record<string, string>;

    given(/^a settings map with selftransfer_scan_ack set to "(.*)"$/, (value: string) => {
      input = { selftransfer_scan_ack: value };
    });

    when(/^I filter it with settingsForRestore$/, () => {
      result = settingsForRestore(input);
    });

    then(/^the result should not contain selftransfer_scan_ack$/, () => {
      expect(result).not.toHaveProperty('selftransfer_scan_ack');
    });
  });
});
