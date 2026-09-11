Feature: Restore sequencing — download before read, read before apply
  A restore must never touch anything destructive before the backup file is
  confirmed fully on the device (spec D2; guardrail #1: "back up/restore
  must round-trip"). `runRestoreSequence` is the one place this ordering is
  decided — src/features/backup/repository.ts wires the real effects for
  both the `.sqlite` and legacy `.json` routes, but the ORDER itself is
  proven here, directly, so a future edit that drops or reorders an await
  breaks a named scenario instead of only a QA trace.

  Scenario: runRestoreSequence downloads before reading, and reads before applying
    Given effects that record their own call order
    When I run the restore sequence
    Then the recorded order should be "ensureDownloaded, readBackup, apply"

  Scenario: runRestoreSequence passes readBackup's result to apply
    Given effects where readBackup resolves with "the-backup-data"
    When I run the restore sequence
    Then apply should have received "the-backup-data"

  Scenario: runRestoreSequence never reads or applies if ensureDownloaded rejects
    Given effects where ensureDownloaded rejects
    When I run the restore sequence and it rejects
    Then readBackup and apply should never have been called

  Scenario: runRestoreSequence never applies if readBackup rejects
    Given effects where readBackup rejects
    When I run the restore sequence and it rejects
    Then apply should never have been called
