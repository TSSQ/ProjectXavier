Feature: Plaintext-SQLite backup format — filenames, routing, table validation
  Assessment M3 moves new backups from plaintext JSON to a whole-DB plaintext
  SQLite image. Backups can be a mix of the new `.sqlite` files and legacy
  `.json` files in the same iCloud container; these are the pure rules that
  govern filenames, which restore path a file takes, and validating an
  attached backup file's tables before any live data is wiped.

  Scenario: buildName always produces a new .sqlite filename
    When I build a backup filename for exportedAt 1700000000000
    Then the filename should be "projectxavier-backup-1700000000000.sqlite"

  Scenario: buildName includes the device idiom when given one (iPhone)
    When I build a backup filename for exportedAt 1700000000000 and device "iPhone"
    Then the filename should be "projectxavier-backup-1700000000000-iPhone.sqlite"

  Scenario: buildName includes the device idiom when given one (iPad)
    When I build a backup filename for exportedAt 1700000000000 and device "iPad"
    Then the filename should be "projectxavier-backup-1700000000000-iPad.sqlite"

  Scenario: parseBackupName recognises a device-suffixed .sqlite name (iPhone)
    Given the filename "projectxavier-backup-1700000000000-iPhone.sqlite"
    When I parse its backup name
    Then the parsed name should have exportedAt 1700000000000, device "iPhone", and format "sqlite"

  Scenario: parseBackupName recognises a device-suffixed .sqlite name (iPad)
    Given the filename "projectxavier-backup-1700000000000-iPad.sqlite"
    When I parse its backup name
    Then the parsed name should have exportedAt 1700000000000, device "iPad", and format "sqlite"

  Scenario: parseBackupName recognises an old .sqlite name without a device
    Given the filename "projectxavier-backup-1700000000000.sqlite"
    When I parse its backup name
    Then the parsed name should have exportedAt 1700000000000, device null, and format "sqlite"

  Scenario: parseBackupName recognises a legacy .json name, which never carries a device
    Given the filename "projectxavier-backup-1600000000000.json"
    When I parse its backup name
    Then the parsed name should have exportedAt 1600000000000, device null, and format "json"

  Scenario: parseBackupName treats an unrecognised device segment as no device, not a rejection
    Given the filename "projectxavier-backup-1700000000000-AppleTV.sqlite"
    When I parse its backup name
    Then the parsed name should have exportedAt 1700000000000, device null, and format "sqlite"

  Scenario: parseBackupName rejects an unrelated file
    Given the filename "Notes.txt"
    When I parse its backup name
    Then the parsed name should be null

  Scenario: parseBackupName rejects a .json name with a device-shaped segment
    Given the filename "projectxavier-backup-1700000000000-iPhone.json"
    When I parse its backup name
    Then the parsed name should be null

  Scenario: parseBackupName rejects a filename with an implausibly long timestamp
    Given the filename "projectxavier-backup-100000000000000000000000000000-iPhone.sqlite"
    When I parse its backup name
    Then the parsed name should be null

  Scenario: parseBackupName accepts a filename with exactly the maximum 15-digit timestamp
    Given the filename "projectxavier-backup-123456789012345.sqlite"
    When I parse its backup name
    Then the parsed name should have exportedAt 123456789012345, device null, and format "sqlite"

  Scenario: parseBackupName rejects a filename with a 16-digit timestamp, one past the cap
    Given the filename "projectxavier-backup-1234567890123456.sqlite"
    When I parse its backup name
    Then the parsed name should be null

  Scenario: parseBackupName rejects a .sqlite name whose device segment isn't alphanumeric
    Given the filename "projectxavier-backup-1700000000000-Apple TV.sqlite"
    When I parse its backup name
    Then the parsed name should be null

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
