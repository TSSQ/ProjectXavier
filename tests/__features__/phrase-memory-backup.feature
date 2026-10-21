Feature: Phrase memory is migrated additively and survives backup and restore
  Phrase memory (src/domain/phraseMemory.ts) is the user's own data, so it
  rides in the whole-database backup image (ADR 0006) and every restored row
  is validated before it is written. An image or a legacy JSON backup from
  before the table existed restores with an empty memory.

  Scenario: An existing database gains the table, and migrating again changes nothing
    Given a database migrated before phrase memory existed
    When the migrations run twice
    Then it has a phrase_memory table with every column

  Scenario: Phrase memory round-trips through a backup image
    Given a database holding two phrase memories
    When I back it up as a SQLite image and restore it into a fresh database
    Then the restored phrase memories equal the originals

  Scenario: Question term memory round-trips through a backup image
    Given a database holding the question term "food" remembered as Dining
    When I back it up as a SQLite image and restore it into a fresh database
    Then the restored question term still reads "food" as Dining

  Scenario: An image from before phrase memory existed restores with none
    Given a backup image with no phrase_memory table
    When I read it back
    Then it is accepted with no phrase memories

  Scenario: A corrupt phrase memory row rejects the whole restore
    Given a backup image whose phrase memory verdict is "maybe"
    When I read it back
    Then it is rejected naming the phrase_memory table

  Scenario: A legacy JSON backup never carries phrase memory
    Given a legacy JSON backup carrying a phraseMemory array
    When I parse it
    Then it parses and carries no phrase memory
