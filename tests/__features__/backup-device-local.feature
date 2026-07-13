Feature: Device-local settings never travel in a backup or restore
  biometric_lock, backup_auto_enabled, and theme are per-device/security
  preferences, not user data — they must never be written into a backup file,
  and a restore must never write them onto the device (an older backup may
  still contain biometric_lock='1', which restoring must not re-enable).

  Scenario: The exclusion lists contain exactly the right keys
    Then DEVICE_LOCAL_SETTINGS_KEYS should contain biometric_lock, backup_auto_enabled, and theme
    And SETTINGS_EXCLUDED_FROM_BACKUP should contain the bookkeeping and device-local keys

  Scenario: settingsForRestore drops device-local keys but keeps user data
    Given a settings map with biometric_lock, backup_auto_enabled, theme, currency, avatar_look, and avatar_kind
    When I filter it with settingsForRestore
    Then the result should not contain biometric_lock, backup_auto_enabled, or theme
    And the result should still contain currency, avatar_look, and avatar_kind

  Scenario: Restoring a backup with biometric_lock='1' does not carry it onto the device
    Given a settings map with biometric_lock set to "1"
    When I filter it with settingsForRestore
    Then the result should not contain biometric_lock

  Scenario: An empty settings map filters to an empty map
    Given an empty settings map
    When I filter it with settingsForRestore
    Then the result should be an empty map

  Scenario: settingsForBackup drops bookkeeping and device-local keys but keeps user data
    Given a settings map with backup_last_sig, backup_last_at, biometric_lock, backup_auto_enabled, theme, currency, avatar_look, and avatar_kind
    When I filter it with settingsForBackup
    Then the backup result should not contain any excluded key
    And the backup result should still contain currency, avatar_look, and avatar_kind

  Scenario: An empty settings map filters to an empty map for the backup direction
    Given an empty settings map
    When I filter it with settingsForBackup
    Then the result should be an empty map

  Scenario: An unrelated future key survives settingsForRestore unchanged
    Given a settings map with an unrelated notification_pref key, biometric_lock, and currency
    When I filter it with settingsForRestore
    Then the result should equal notification_pref daily and currency EUR only

  Scenario: An unrelated future key survives settingsForBackup unchanged
    Given a settings map with an unrelated notification_pref key, a bookkeeping key, biometric_lock, and currency
    When I filter it with settingsForBackup
    Then the result should equal notification_pref daily and currency EUR only
