Feature: Future-dated transactions are excluded from money math until their date arrives
  A transaction dated in the future stays visible in the ledger (with an
  "Upcoming" chip) but must contribute zero to every total, balance, count,
  and net-worth figure until its date arrives — the same "recorded but not
  counted" treatment `pending` already gets, just date-driven instead of
  manual (docs/design/future-dated-transactions-spec.md).

  # ── isCounted (acceptance criteria 1 and 7) ───────────────────────────────

  Scenario: A future-dated transaction is not counted
    Given now is "2026-06-15"
    And a transaction dated "2026-06-25"
    Then the transaction should not be counted

  Scenario: A transaction dated exactly now is counted (the boundary)
    Given now is "2026-06-15"
    And a transaction dated "2026-06-15"
    Then the transaction should be counted

  Scenario: A past-dated transaction is counted
    Given now is "2026-06-15"
    And a transaction dated "2026-06-10"
    Then the transaction should be counted

  Scenario: A pending transaction is never counted, regardless of date
    Given now is "2026-06-15"
    And a pending transaction dated "2026-06-10"
    Then the transaction should not be counted

  # ── totalsForRange (acceptance criterion 2) ───────────────────────────────

  Scenario: totalsForRange excludes a future-dated row within the range
    Given now is "2026-06-15"
    And the following transactions:
      | type    | amount | date       |
      | expense | 10.00  | 2026-06-10 |
      | expense | 20.00  | 2026-06-25 |
    When I view totals for "month" of "2026-06"
    Then the expense total should be 10.00

  Scenario: The same row counts once now passes its date
    Given now is "2026-06-25"
    And the following transactions:
      | type    | amount | date       |
      | expense | 10.00  | 2026-06-10 |
      | expense | 20.00  | 2026-06-25 |
    When I view totals for "month" of "2026-06"
    Then the expense total should be 30.00

  # ── Category donut and time buckets (acceptance criterion 3) ─────────────

  Scenario: categoryBreakdown excludes a future-dated row
    Given now is "2026-06-15"
    And the following categorised transactions:
      | type    | category | amount | date       |
      | expense | Dining   | 10.00  | 2026-06-10 |
      | expense | Dining   | 20.00  | 2026-06-25 |
    When I compute the expense category breakdown for "2026-06"
    Then slice 1 should be category "Dining" with amount 10.00

  Scenario: groupByPeriod excludes a future-dated row from its bucket
    Given now is "2026-06-15"
    And the following transactions:
      | type    | amount | date       |
      | expense | 10.00  | 2026-06-10 |
      | expense | 20.00  | 2026-06-25 |
    When I group transactions by "month"
    Then the "2026-06" bucket expense total should be 10.00

  Scenario: cashFlowSeries excludes a future-dated row from its bucket
    Given now is "2026-06-15"
    And the following transactions:
      | type    | amount | date       |
      | expense | 10.00  | 2026-06-10 |
      | expense | 20.00  | 2026-06-25 |
    When I compute the cash flow series for "2026-06" by "day"
    Then the "2026-06-10" cash-flow expense should be 10.00
    And the "2026-06-25" cash-flow expense should be 0.00

  # ── accountBalance / netWorth (acceptance criterion 4) ────────────────────

  Scenario: accountBalance excludes a future-dated transaction
    Given now is "2026-06-15"
    And an asset account "Checking" with opening balance 100.00
    And a 30.00 expense dated "2026-06-25" from "Checking"
    Then the balance of "Checking" should be 100.00

  Scenario: netWorth excludes a future-dated transaction
    Given now is "2026-06-15"
    And an asset account "Checking" with opening balance 100.00
    And a 30.00 expense dated "2026-06-25" from "Checking"
    Then the net worth should be 100.00

  # ── netWorthAsOf regression (acceptance criterion 4 — must NOT change) ────

  Scenario: netWorthAsOf still excludes a future-dated row when asOf is before its date
    Given an asset account "Checking" with opening balance 100.00
    And a 30.00 expense dated "2026-06-25" from "Checking"
    Then the net worth as of "2026-06-15" should be 100.00

  Scenario: netWorthAsOf still includes a row on or before asOf, even when asOf itself is in the future
    Given an asset account "Checking" with opening balance 100.00
    And a 30.00 expense dated "2026-06-25" from "Checking"
    Then the net worth as of "2026-06-25" should be 70.00

  # ── Backup round-trip (acceptance criterion 9) ────────────────────────────

  Scenario: A future-dated row round-trips through the current SQLite-backup restore path and stays uncounted
    Given now is "2026-06-15"
    And a raw transactions row dated "2026-06-25"
    When I build BackupData from the attached rows
    Then the resulting transaction's occurredAt should be unchanged
    And the resulting transaction should not be counted

  Scenario: A future-dated row round-trips through the legacy JSON backup format and stays uncounted
    Given now is "2026-06-15"
    And a backup dataset with a transaction dated "2026-06-25"
    When I serialize and parse the backup
    Then the restored transaction's occurredAt should be unchanged
    And the restored transaction should not be counted

  # ── Recurring series anchored in the future (acceptance criterion 8) ─────

  Scenario: A recurring series anchored in the future posts nothing before the anchor
    Given a monthly series anchored on "2026-08-01" with no last post
    When I check due occurrences as of "2026-06-15"
    Then due occurrences should be empty

  Scenario: The series posts once the anchor date arrives
    Given a monthly series anchored on "2026-08-01" with no last post
    When I check due occurrences as of "2026-08-01"
    Then due occurrences should be "2026-08-01"

  Scenario: The series keeps posting normally in later months once started
    Given a monthly series anchored on "2026-08-01" with no last post
    When I check due occurrences as of "2026-10-05"
    Then due occurrences should be "2026-08-01", "2026-09-01", "2026-10-01"

  # ── isUpcoming — the "Upcoming" chip predicate (spec §4.3) ────────────────

  Scenario: isUpcoming is true for a future-dated, non-pending transaction
    Given now is "2026-06-15"
    And a transaction dated "2026-06-25"
    Then the transaction should be upcoming

  Scenario: isUpcoming is false for a pending transaction even when future-dated
    Given now is "2026-06-15"
    And a pending transaction dated "2026-06-25"
    Then the transaction should not be upcoming

  Scenario: isUpcoming is false for a past-dated transaction
    Given now is "2026-06-15"
    And a transaction dated "2026-06-10"
    Then the transaction should not be upcoming

  # ── same-day, different time (the "TODAY · UPCOMING" contradiction) ────────
  # Recurring occurrences are stored at LOCAL NOON (the timezone-stable day
  # identity — see localDayNoon). isCounted/isUpcoming used to compare that
  # instant against the wall clock, while the ledger groups by calendar day,
  # so before midday a row sat under TODAY wearing an UPCOMING pill AND was
  # missing from every total until 12:00. "If it's today, it's today":
  # both predicates compare calendar days.

  Scenario: A noon-dated row is counted from the start of that day
    Given now is local "2026-06-15 09:10"
    And a transaction dated local "2026-06-15 12:00"
    Then the transaction should be counted
    And the transaction should not be upcoming

  Scenario: A row dated later today is still today
    Given now is local "2026-06-15 09:10"
    And a transaction dated local "2026-06-15 23:00"
    Then the transaction should be counted
    And the transaction should not be upcoming

  Scenario: A row dated earlier today stays counted
    Given now is local "2026-06-15 23:00"
    And a transaction dated local "2026-06-15 00:30"
    Then the transaction should be counted
    And the transaction should not be upcoming

  # Tomorrow is still tomorrow, however close the clock is to it.
  Scenario: A row dated just after midnight tomorrow is upcoming
    Given now is local "2026-06-15 23:59"
    And a transaction dated local "2026-06-16 00:30"
    Then the transaction should not be counted
    And the transaction should be upcoming

  Scenario: Pending still wins over the day comparison
    Given now is local "2026-06-15 09:10"
    And a pending transaction dated local "2026-06-15 12:00"
    Then the transaction should not be counted
    And the transaction should not be upcoming
