Feature: Plaintext backup and restore
  Data must survive device loss via a restorable plaintext backup stored in iCloud.

  Scenario: Serialize and parse round-trips a dataset including recurringSeries
    Given a dataset with 1 account, 2 transactions, and 1 recurring series
    When I serialize the backup
    Then parsing the serialized backup should return the original data including recurringSeries

  Scenario: A 0-decimal (JPY) ledger's amounts and currency survive a round-trip unchanged
    Given a JPY dataset with an account opening balance of 100000 and a transaction amount of 500
    When I serialize the backup
    Then parsing the serialized backup should preserve the JPY account and transaction unchanged

  Scenario: parseBackup rejects version 3
    Given a backup JSON with version 3
    Then parsing it should throw an unsupported version error

  Scenario: parseBackup rejects a version-1 payload (no recurringSeries handling)
    Given a version-1 backup JSON without recurringSeries
    Then parsing it should throw a malformed-data error

  Scenario: parseBackup throws on malformed JSON
    Given a malformed JSON string
    Then parsing it should throw a parse error
