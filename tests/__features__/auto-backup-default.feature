Feature: Auto-backup default is opt-out
  A lost SQLCipher key makes the user's own iCloud backup the only recovery
  path, so auto-backup is opt-out, not opt-in: a fresh install (no stored
  preference) must auto-back-up until the user explicitly turns it off.
  resolveAutoBackupEnabled is the pure stored-value → boolean resolution both
  the repository (maybeAutoBackup) and the Backups screen defer to.

  Scenario: An unset preference resolves to on
    Given no stored auto-backup preference
    When the auto-backup preference is resolved
    Then auto-backup should be on

  Scenario: A stored "on" preference resolves to on
    Given a stored auto-backup preference of "1"
    When the auto-backup preference is resolved
    Then auto-backup should be on

  Scenario: A stored "off" preference resolves to off
    Given a stored auto-backup preference of "0"
    When the auto-backup preference is resolved
    Then auto-backup should be off

  Scenario: An undefined preference resolves to on
    Given an undefined auto-backup preference
    When the auto-backup preference is resolved
    Then auto-backup should be on
