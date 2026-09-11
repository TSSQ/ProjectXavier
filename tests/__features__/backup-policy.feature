Feature: Backup policy — pruning and auto-backup gating
  The system keeps only the 3 newest backups and only auto-backs up when data
  has changed and enough time has elapsed.

  Scenario: Prune keeps the 3 newest backups
    Given 5 backups ordered by age
    When I select backups to prune keeping 3
    Then the 2 oldest backups should be returned for deletion

  Scenario: Prune keeps the 3 newest across a mixed .json/.sqlite list
    Given 5 backups ordered by age with mixed .json and .sqlite suffixes
    When I select backups to prune keeping 3
    Then the 2 oldest backups should be returned for deletion regardless of suffix

  # ─── pruneTolerantly (QA round 3 B1) ───────────────────────────────────

  Scenario: pruneTolerantly deletes the backups beyond the keep window
    Given 5 backups ordered by age
    When I prune tolerantly keeping 3
    Then removeBackup should have been called for the 2 oldest backups

  Scenario: pruneTolerantly does nothing, and does not throw, when listing fails
    Given a listing that always fails
    When I prune tolerantly keeping 3
    Then pruning should not have thrown
    And removeBackup should never have been called

  Scenario: pruneTolerantly tolerates a single remove failure and continues pruning the rest
    Given 5 backups ordered by age
    And removeBackup fails for the single oldest backup
    When I prune tolerantly keeping 3
    Then pruning should not have thrown
    And removeBackup should have been attempted for both oldest backups
    And only the surviving one should have actually been removed

  Scenario: shouldAutoBackup is false when signature is unchanged
    Given a current signature "1:2:3:4:0:0" matching the last backup signature
    Then shouldAutoBackup should return false regardless of time elapsed

  Scenario: shouldAutoBackup is false when within the minimum interval
    Given a current signature "1:2:3:4:0:0" different from last signature "0:0:0:0:0:0"
    And the last backup was 30 minutes ago
    Then shouldAutoBackup should return false

  Scenario: shouldAutoBackup is true when data changed and interval elapsed
    Given a current signature "1:2:3:4:0:0" different from last signature "0:0:0:0:0:0"
    And the last backup was 2 hours ago
    Then shouldAutoBackup should return true

  Scenario: An empty dataset has a stable v2 signature
    Given an empty dataset
    Then its backup signature should be "v2:0:"

  Scenario: Computing the signature twice for the same dataset is stable
    Given an empty dataset
    When I compute the signature again with nothing changed
    Then the signature should not change

  Scenario: Bumping the data revision changes the signature
    Given an empty dataset
    When I bump only the data revision
    Then the signature should change

  Scenario: Adding a transaction with no revision bump does not change the signature
    Given an empty dataset
    When I add one transaction without bumping the data revision
    Then the signature should not change

  Scenario: Changing a setting changes the signature
    Given an empty dataset
    When I change the currency setting
    Then the signature should change

  Scenario: A v2 signature can never equal a v1-format signature
    Given an empty dataset
    Then its v2 signature should not equal any v1-format signature string

  Scenario: shouldAutoBackup still clamps to the minimum interval with v2 signatures
    Given a current v2 signature different from the last v2 signature
    And the last backup was 30 minutes ago
    Then shouldAutoBackup should return false

  Scenario: shouldAutoBackup still fires with v2 signatures once the interval has elapsed
    Given a current v2 signature different from the last v2 signature
    And the last backup was 2 hours ago
    Then shouldAutoBackup should return true
