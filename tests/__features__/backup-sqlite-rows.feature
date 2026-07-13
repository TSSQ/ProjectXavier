Feature: Plaintext-SQLite restore — row mapping and validation
  A `.sqlite` backup is read back into JS and validated through the existing
  zod schemas before any live table is touched (assessment M3 QA fix). Raw
  rows are keyed by the literal SQL column name (snake_case) with 0/1
  integers for boolean columns — never the JS domain shape directly.

  Scenario: A cross-schema restore fills in defaults for columns an older backup lacks
    Given a raw transactions row missing the pending, series_id, occurrence_date, receipt_ref, and source_text columns
    When I build BackupData from the attached rows
    Then it should succeed
    And the resulting transaction should have pending false and no seriesId

  Scenario: A row with a non-numeric amount and an invalid type is rejected
    Given a raw transactions row with amount "NOT_A_NUMBER", type "bogus", and a dangling account_id
    When I build BackupData from the attached rows
    Then it should throw an error mentioning "transactions"

  Scenario: Boolean columns are coerced from SQLite's 0/1 to real booleans
    Given a raw accounts row with archived stored as the integer 1
    When I build BackupData from the attached rows
    Then the resulting account's archived flag should be the boolean true

  Scenario: Recurring-series JSON text columns round-trip through validation
    Given a raw recurring_series row with rule, template, and skipped_dates stored as JSON text
    When I build BackupData from the attached rows
    Then the resulting series should have a parsed rule, template, and skippedDates array

  Scenario: Settings rows are collected into a key/value map
    Given raw settings rows for "currency" and "theme"
    When I build BackupData from the attached rows
    Then the resulting settings map should contain both keys
