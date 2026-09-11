Feature: iCloud backup sync — stub mapping, status merge, download plan, native payload trust boundary
  A backup made on one device must be listed and restorable on another
  device, and the Backups screen must tell the truth about where each file
  is. These are the pure rules src/domain/backupSync.ts owns: mapping a
  `readdir` stub to its logical name, merging many raw cloud-status flags
  into one row state, deciding whether a download is restorable, the
  download-wait policy `ensureDownloaded`'s polling loop follows, and
  validating the native module's payload (guardrail #6) without ever
  throwing at the list caller.

  # ─── stubToLogicalName ──────────────────────────────────────────────────

  Scenario: stubToLogicalName recovers the logical name from a not-yet-downloaded stub
    Given the raw directory entry ".projectxavier-backup-1700000000000-iPhone.sqlite.icloud"
    When I map it to a logical name
    Then the logical name should be "projectxavier-backup-1700000000000-iPhone.sqlite"

  Scenario: stubToLogicalName returns null for a name that is not a stub
    Given the raw directory entry "projectxavier-backup-1700000000000-iPhone.sqlite"
    When I map it to a logical name
    Then the logical name should be null

  Scenario: stubToLogicalName recovers the logical name even for a stub of a non-backup file
    Given the raw directory entry ".Notes.txt.icloud"
    When I map it to a logical name
    Then the logical name should be "Notes.txt"

  # ─── mergeFallbackListing ───────────────────────────────────────────────

  Scenario: mergeFallbackListing mixes downloaded files and not-yet-downloaded stubs
    Given a raw readdir listing of:
      | name                                                     |
      | projectxavier-backup-1700000000000-iPhone.sqlite         |
      | .projectxavier-backup-1690000000000-iPad.sqlite.icloud   |
      | .projectxavier-backup-1680000000000.sqlite.icloud        |
    When I merge the fallback listing
    Then it should report:
      | name                                                | downloaded |
      | projectxavier-backup-1700000000000-iPhone.sqlite    | true       |
      | projectxavier-backup-1690000000000-iPad.sqlite      | false      |
      | projectxavier-backup-1680000000000.sqlite           | false      |

  Scenario: mergeFallbackListing dedupes a logical name reported as both a stub and a real file
    Given a raw readdir listing of:
      | name                                                     |
      | projectxavier-backup-1700000000000-iPhone.sqlite         |
      | .projectxavier-backup-1700000000000-iPhone.sqlite.icloud |
    When I merge the fallback listing
    Then it should report:
      | name                                                | downloaded |
      | projectxavier-backup-1700000000000-iPhone.sqlite    | true       |

  # ─── rowState — precedence: error > downloading > uploading > inCloud > onDevice ──

  Scenario: rowState — a download error beats every other in-flight flag
    Given a status that is downloading, uploading, and has a download error
    When I merge it into a row state
    Then the row state should be "downloadError"

  Scenario: rowState — an upload error beats downloading, uploading, and inCloud
    Given a status that is downloading and uploading with an upload error but no download error
    When I merge it into a row state
    Then the row state should be "uploadError"

  Scenario: rowState — downloading beats uploading and inCloud
    Given a status that is downloading and uploading with no errors
    When I merge it into a row state
    Then the row state should be "downloading"

  Scenario: rowState — uploading beats inCloud
    Given a status that is uploading and not downloaded, with no errors
    When I merge it into a row state
    Then the row state should be "uploading"

  Scenario: rowState — a not-yet-downloaded file with nothing in flight is inCloud
    Given a status that is notDownloaded with nothing in flight and no errors
    When I merge it into a row state
    Then the row state should be "inCloud"

  Scenario: rowState — a current file with nothing in flight is onDevice
    Given a status that is current with nothing in flight and no errors
    When I merge it into a row state
    Then the row state should be "onDevice"

  # ─── isRestorable ───────────────────────────────────────────────────────

  Scenario: isRestorable is true for a current, non-transferring file
    Given a status that is current with nothing in flight and no errors
    When I check whether it is restorable
    Then it should be restorable

  Scenario: isRestorable is false while still downloading, even if marked current
    Given a status that is current but still downloading
    When I check whether it is restorable
    Then it should not be restorable

  Scenario: isRestorable is false for a not-yet-downloaded file
    Given a status that is notDownloaded with nothing in flight and no errors
    When I check whether it is restorable
    Then it should not be restorable

  # ─── shouldKeepWaiting (the download plan / timeout policy) ────────────

  Scenario: shouldKeepWaiting says wait when within both budgets with recent progress
    Given a download 5000ms in with progress observed 1000ms ago
    When I ask whether to keep waiting
    Then the decision should be "wait"

  Scenario: shouldKeepWaiting stalls after 30 seconds without progress
    Given a download 40000ms in with progress observed 31000ms ago
    When I ask whether to keep waiting
    Then the decision should be "stalled"

  Scenario: shouldKeepWaiting times out after 120 seconds total, even with recent progress
    Given a download 120000ms in with progress observed 500ms ago
    When I ask whether to keep waiting
    Then the decision should be "timedOut"

  Scenario: shouldKeepWaiting prefers timedOut over stalled when both budgets are blown at once
    Given a download 150000ms in with progress observed 150000ms ago
    When I ask whether to keep waiting
    Then the decision should be "timedOut"

  Scenario: shouldKeepWaiting — progress resets the stall clock
    Given a download 100000ms in with progress observed 0ms ago
    When I ask whether to keep waiting
    Then the decision should be "wait"

  Scenario: shouldKeepWaiting stalls at exactly the 30-second boundary
    Given a download 40000ms in with progress observed 30000ms ago
    When I ask whether to keep waiting
    Then the decision should be "stalled"

  Scenario: shouldKeepWaiting times out at exactly the 120-second boundary
    Given a download 120000ms in with progress observed 0ms ago
    When I ask whether to keep waiting
    Then the decision should be "timedOut"

  Scenario: shouldKeepWaiting never stalls when there is no progress signal at all
    Given a download 40000ms in with no progress signal
    When I ask whether to keep waiting
    Then the decision should be "wait"

  Scenario: shouldKeepWaiting still times out at 120 seconds with no progress signal at all
    Given a download 120000ms in with no progress signal
    When I ask whether to keep waiting
    Then the decision should be "timedOut"

  # ─── CloudEntrySchema — the native payload trust boundary (guardrail #6) ─

  Scenario: CloudEntrySchema accepts a well-formed native payload item
    Given a well-formed native cloud entry payload
    When I validate it against CloudEntrySchema
    Then validation should succeed

  Scenario: CloudEntrySchema accepts a payload with no size (the status() shape)
    Given a native cloud entry payload with no size field
    When I validate it against CloudEntrySchema
    Then validation should succeed

  Scenario: CloudEntrySchema accepts a payload with percentDownloaded/percentUploaded omitted entirely
    Given a native cloud entry payload with the percent fields omitted, not null
    When I validate it against CloudEntrySchema
    Then validation should succeed

  Scenario: CloudEntrySchema rejects a malformed payload without throwing
    Given a malformed native cloud entry payload with a non-boolean isDownloading
    When I validate it against CloudEntrySchema
    Then validation should fail without throwing

  # ─── parseCloudEntryOrThrow — statusFor's distinct failure signal (QA round 3 M1) ─

  Scenario: parseCloudEntryOrThrow returns the parsed entry for a well-formed payload
    Given a well-formed native cloud entry payload
    When I parse it with parseCloudEntryOrThrow
    Then it should return the parsed entry, not throw

  Scenario: parseCloudEntryOrThrow throws a distinct schema error for a malformed payload, not a status that reads as legitimate
    Given a malformed native cloud entry payload with a non-boolean isDownloading
    When I parse it with parseCloudEntryOrThrow
    Then it should throw a CloudStatusSchemaError, not return a value

  # ─── CloudNamesSchema — readdir's return, the same trust boundary (QA round 3 minor 5) ─

  Scenario: CloudNamesSchema accepts a well-formed array of names
    Given a raw readdir result of well-formed names
    When I validate it against CloudNamesSchema
    Then validation should succeed

  Scenario: CloudNamesSchema rejects a malformed readdir result without throwing
    Given a raw readdir result that is not an array of strings
    When I validate it against CloudNamesSchema
    Then validation should fail without throwing

  # ─── listWithFallback — the listing fallthrough (QA round 3 B1) ────────

  Scenario: listWithFallback returns the module listing's result without calling the fallback
    Given a module listing that succeeds with "module-result"
    And a fallback listing that would return "fallback-result"
    When I run listWithFallback
    Then the result should be "module-result"
    And the fallback listing should never have been called

  Scenario: listWithFallback falls through to the fallback listing when the module listing throws
    Given a module listing that throws ERR_ICLOUD_GATHER_TIMEOUT
    And a fallback listing that would return "fallback-result"
    When I run listWithFallback
    Then the result should be "fallback-result"

  Scenario: listWithFallback propagates the fallback listing's own failure when both branches throw
    Given a module listing that throws ERR_ICLOUD_GATHER_TIMEOUT
    And a fallback listing that also throws
    When I run listWithFallback and it rejects
    Then listWithFallback should reject with the fallback listing's own error

  # ─── Fallback adapter double (spec §6.7 / §9 — no native module, smoke test) ─

  Scenario: Fallback ensureDownloaded double resolves once the file appears locally
    Given a fallback download double where the file appears on the 3rd check
    When I run the fallback download double
    Then the fallback outcome should be "downloaded"

  Scenario: Fallback ensureDownloaded double resolves when the file appears slowly, past the old 30s stall threshold
    Given a fallback download double where the file appears after 40 seconds
    When I run the fallback download double
    Then the fallback outcome should be "downloaded"

  Scenario: Fallback ensureDownloaded double times out at 120 seconds when the file never appears
    Given a fallback download double where the file never appears
    When I run the fallback download double
    Then the fallback outcome should be "timedOut"
