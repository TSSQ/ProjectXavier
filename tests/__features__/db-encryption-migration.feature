Feature: DB encryption migration decision (H4)
  The one-time plaintext -> encrypted DB migration (src/db/client.ts) decides
  what to do from two probe outcomes: a keyed `SELECT count(*) FROM
  sqlite_master`, and — only when that fails — the same probe run again with
  no key on the same file. It also decides a pre-open filesystem recovery
  action from which of the canonical DB file and the scratch encrypted-export
  file exist on disk, before either is opened, to repair a swap interrupted
  between its two non-atomic steps (delete the plaintext original, then move
  the verified encrypted copy into place) — without this, a crash in that gap
  would silently orphan a fully-migrated user's data. src/db/encryptionMigrationPlan.ts
  factors all of this — the migration decision, the verify-before-delete
  row-count gate, and the startup recovery decision — into pure functions so
  they're provable without a real SQLCipher build.

  Scenario: A keyed probe that succeeds needs no migration
    Given the keyed probe succeeds
    When I decide the migration action
    Then no migration should be needed

  Scenario: A keyed probe that fails but an unkeyed probe succeeds is legacy plaintext
    Given the keyed probe fails
    And the unkeyed probe succeeds
    When I decide the migration action
    Then the database should be migrated

  Scenario: A keyed probe that fails and an unkeyed probe that also fails is unresolvable
    Given the keyed probe fails
    And the unkeyed probe also fails
    When I decide the migration action
    Then the migration should be refused as key-missing-or-corrupt

  Scenario: Matching row counts on a key-opening copy verifies the migration
    Given the encrypted copy opens with the key
    And the plaintext and encrypted row counts match for every table
    When I check whether the migration is verified
    Then the migration should be verified

  Scenario: A copy that fails to open with the key is never verified
    Given the encrypted copy does not open with the key
    And the plaintext and encrypted row counts match for every table
    When I check whether the migration is verified
    Then the migration should not be verified

  Scenario: Mismatched row counts are never verified
    Given the encrypted copy opens with the key
    And the plaintext and encrypted row counts differ for a table
    When I check whether the migration is verified
    Then the migration should not be verified

  Scenario: A plaintext source with zero tables verifies trivially
    Given the encrypted copy opens with the key
    And the plaintext source has no tables at all
    When I check whether the migration is verified
    Then the migration should be verified

  Scenario: A zero-table plaintext source with a copy that fails to open is never verified
    Given the encrypted copy does not open with the key
    And the plaintext source has no tables at all
    When I check whether the migration is verified
    Then the migration should not be verified

  Scenario: Neither file present needs no startup recovery
    Given the canonical DB file is absent
    And the encrypted export file is absent
    When I decide the startup recovery action
    Then no startup recovery should be needed

  Scenario: Only the canonical DB file present needs no startup recovery
    Given the canonical DB file is present
    And the encrypted export file is absent
    When I decide the startup recovery action
    Then no startup recovery should be needed

  Scenario: An orphaned encrypted export with no canonical DB must be recovered
    Given the canonical DB file is absent
    And the encrypted export file is present
    When I decide the startup recovery action
    Then the orphaned encrypted export should be moved into place

  Scenario: Both files present means the stale export should be discarded
    Given the canonical DB file is present
    And the encrypted export file is present
    When I decide the startup recovery action
    Then the stale encrypted export should be discarded

  Scenario: The state left behind by a successful migration needs no further recovery
    Given the canonical DB file is present
    And the encrypted export file is absent
    When I decide the startup recovery action
    Then no startup recovery should be needed
    And no stray encrypted export file is left at the canonical path

  Scenario: Sidecar filenames are derived from the db filename
    When I derive the WAL/SHM sidecar names for "projectxavier.db"
    Then the sidecar names should be "projectxavier.db-wal" and "projectxavier.db-shm"

  Scenario: Sidecar filenames are derived from the enc export filename
    When I derive the WAL/SHM sidecar names for "projectxavier.enc.db"
    Then the sidecar names should be "projectxavier.enc.db-wal" and "projectxavier.enc.db-shm"
