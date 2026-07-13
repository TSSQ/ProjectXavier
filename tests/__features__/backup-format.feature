Feature: Plaintext-SQLite backup format — filenames, routing, table validation
  Assessment M3 moves new backups from plaintext JSON to a whole-DB plaintext
  SQLite image. Backups can be a mix of the new `.sqlite` files and legacy
  `.json` files in the same iCloud container; these are the pure rules that
  govern filenames, which restore path a file takes, and validating an
  attached backup file's tables before any live data is wiped.

  Scenario: buildName always produces a new .sqlite filename
    When I build a backup filename for exportedAt 1700000000000
    Then the filename should be "projectxavier-backup-1700000000000.sqlite"

  Scenario: parseExportedAt recognises the new .sqlite convention
    Given the filename "projectxavier-backup-1700000000000.sqlite"
    When I parse its exportedAt
    Then the parsed exportedAt should be 1700000000000

  Scenario: parseExportedAt recognises the legacy .json convention
    Given the filename "projectxavier-backup-1600000000000.json"
    When I parse its exportedAt
    Then the parsed exportedAt should be 1600000000000

  Scenario: parseExportedAt ignores unrelated files
    Given the filename "Notes.txt"
    When I parse its exportedAt
    Then the parsed exportedAt should be null

  Scenario: restoreRouteFor routes .sqlite files to the sqlite restore path
    Given the filename "projectxavier-backup-1700000000000.sqlite"
    Then it should route to the "sqlite" restore path

  Scenario: restoreRouteFor routes .json files to the legacy restore path
    Given the filename "projectxavier-backup-1600000000000.json"
    Then it should route to the "json" restore path

  Scenario: missingTables reports nothing when every expected table is present
    Given an attached database with all 6 expected tables
    Then missingTables should report no missing tables

  Scenario: missingTables reports absent tables in a foreign/corrupt file
    Given an attached database missing the "transactions" and "settings" tables
    Then missingTables should report "transactions" and "settings" as missing
