Feature: Budgets survive the SQLite-image backup and restore
  Backups are a whole-database SQLite image (ADR 0006); restore reads each
  table back and validates every row. Budgets are in the image, restore
  returns them, and an image from before the table existed still restores
  (spec section 3, acceptance 10).

  Scenario: Budgets round-trip through a backup image
    Given a database holding the mockup budgets and a one-off
    When I back it up as a SQLite image and restore it into a fresh database
    Then the restored budgets should equal the originals

  Scenario: An image from before budgets existed restores with none
    Given a backup image with no budgets table
    When I read it back
    Then it should be accepted with no budgets

  Scenario: A corrupt budget row rejects the whole restore
    Given a backup image whose budget amount is "NOT_A_NUMBER"
    When I read it back
    Then it should be rejected naming the budgets table

  Scenario: A legacy JSON backup restores without budgets
    Given a legacy JSON backup
    When I parse it
    Then it should parse and carry no budgets

  Scenario: A legacy JSON backup with a malformed budgets array restores with no budgets
    Given a legacy JSON backup carrying a malformed budgets array
    When I parse it
    Then it should parse and carry no budgets
