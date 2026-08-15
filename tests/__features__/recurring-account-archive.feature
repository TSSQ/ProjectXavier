Feature: Recurring series pause/resume via account archive (§8.3)
  Archiving an account pauses its recurring series without writing any
  paused/archived flag on the series itself (docs/design/
  account-archive-restore-spec.md §8.3): the post-time gate
  (`postableOccurrences`) skips posting into an archived account, and
  unarchiving replays the schedule forward from that moment
  (`seriesToResumeOnUnarchive`) instead of back-posting whatever was missed
  while archived. All pure — no DB, no framework.

  # ── postableOccurrences (the post-time gate) ───────────────────────────────

  Scenario: A series targeting an archived account yields no due occurrences
    Given a monthly series targeting account "acc-1" anchored on "2026-01-01" with no last post
    And account "acc-1" is archived
    Then postable occurrences as of "2026-06-01" should be empty

  Scenario: A series targeting an active account is unaffected
    Given a monthly series targeting account "acc-1" anchored on "2026-01-01" with no last post
    And account "acc-1" is active
    Then postable occurrences as of "2026-03-20" should be "2026-01-01", "2026-02-01", "2026-03-01"

  Scenario: A series whose transfer destination is archived is also gated
    Given a monthly transfer series from account "acc-1" to account "acc-2" anchored on "2026-01-01" with no last post
    And account "acc-1" is active
    And account "acc-2" is archived
    Then postable occurrences as of "2026-06-01" should be empty

  # ── seriesToResumeOnUnarchive (the cursor advance) ─────────────────────────

  Scenario: Unarchiving selects exactly the series targeting that account, and no others
    Given a monthly series "s1" targeting account "acc-1" anchored on "2026-01-01" with no last post
    And a monthly series "s2" targeting account "acc-2" anchored on "2026-01-01" with no last post
    And a monthly transfer series "s3" from account "acc-3" to account "acc-1" anchored on "2026-01-01" with no last post
    When account "acc-1" is unarchived on "2026-06-01"
    Then the series selected to resume should be "s1", "s3"
    And each selected series should have lastPostedAt "2026-06-01"

  # ── The back-fill regression (the point of the feature) ────────────────────

  Scenario: Archiving then unarchiving after a long gap does not back-post a burst
    Given a daily series targeting account "acc-1" anchored on "2026-01-01" last posted on "2026-05-01"
    And account "acc-1" is archived
    Then postable occurrences as of "2026-08-01" should be empty
    When account "acc-1" is unarchived on "2026-08-01"
    Then postable occurrences as of "2026-08-01" should be empty
    And postable occurrences as of "2026-08-02" should be "2026-08-02"

  # ── A user-paused series is never silently resumed ──────────────────────────

  Scenario: A user-paused series stays paused across an archive/unarchive cycle
    Given a paused monthly series targeting account "acc-1" anchored on "2026-01-01" with no last post
    And account "acc-1" is archived
    When account "acc-1" is unarchived on "2026-06-01"
    Then the resumed series should still be paused
    And postable occurrences as of "2026-06-01" should be empty
