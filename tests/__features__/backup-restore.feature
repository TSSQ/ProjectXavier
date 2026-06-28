Feature: Plaintext backup and restore
  Data must survive device loss via a restorable plaintext backup stored in iCloud.

  Scenario: Serialize and parse round-trips a dataset including recurringSeries
    Given a dataset with 1 account, 2 transactions, and 1 recurring series
    When I serialize the backup
    Then parsing the serialized backup should return the original data including recurringSeries

  Scenario: parseBackup rejects version 3
    Given a backup JSON with version 3
    Then parsing it should throw an unsupported version error

  Scenario: A version-1 payload restores with recurringSeries empty
    Given a version-1 backup JSON without recurringSeries
    Then parsing it should succeed with recurringSeries set to an empty array

  Scenario: parseBackup throws on malformed JSON
    Given a malformed JSON string
    Then parsing it should throw a parse error
