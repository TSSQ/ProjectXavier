Feature: Encrypted backup and restore
  Data must survive device loss via an encrypted, restorable backup.

  Scenario: Backup and restore round-trips the data
    Given a dataset with 1 account and 2 transactions
    When I export an encrypted backup with passphrase "correct horse battery staple"
    And I restore the backup with the same passphrase
    Then the restored data should equal the original data

  Scenario: Restoring with the wrong passphrase fails
    Given a dataset with 1 account and 2 transactions
    When I export an encrypted backup with passphrase "correct horse battery staple"
    Then restoring with passphrase "wrong passphrase" should fail
