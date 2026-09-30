Feature: The auto-backup check does the cheap things first
  It used to read the whole dataset on every trip out of the app before even
  checking whether a backup was due (issue #27). The check now runs cheapest
  first and stops at the first reason not to back up. Minimum interval: 1 hour.

  Scenario: Turned off — nothing else is read
    Given auto-backup is off
    When the auto-backup check runs
    Then the outcome should be "disabled"
    And it should only have called "autoEnabled"

  Scenario: Too soon since the last backup — the signature is never computed
    Given the last backup was 10 minutes ago
    When the auto-backup check runs
    Then the outcome should be "too_soon"
    And it should only have called "autoEnabled, lastBackup"

  Scenario: Nothing changed — iCloud is not even asked
    Given the last backup was 2 hours ago with the current signature
    When the auto-backup check runs
    Then the outcome should be "unchanged"
    And it should only have called "autoEnabled, lastBackup, signature"

  Scenario: Changed but no iCloud — no backup
    Given the last backup was 2 hours ago with an older signature
    And iCloud is unavailable
    When the auto-backup check runs
    Then the outcome should be "no_icloud"
    And it should only have called "autoEnabled, lastBackup, signature, cloudAvailable"

  Scenario: Changed and due — backs up and records it
    Given the last backup was 2 hours ago with an older signature
    When the auto-backup check runs
    Then the outcome should be "backed_up"
    And it should only have called "autoEnabled, lastBackup, signature, cloudAvailable, backup, record"
