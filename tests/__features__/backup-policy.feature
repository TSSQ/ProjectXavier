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

  Scenario: An empty dataset has a stable signature
    Given an empty dataset
    Then its backup signature should be "0:0:0:0:0:0:"

  Scenario: Adding a transaction changes the signature
    Given an empty dataset
    When I add one transaction
    Then the signature should change

  Scenario: Changing a setting changes the signature
    Given an empty dataset
    When I change the currency setting
    Then the signature should change
