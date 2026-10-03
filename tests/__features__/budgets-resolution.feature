Feature: Budgets resolve per category and month, and writes carry forward
  A budget row says "this amount applies to this category from start_month to
  end_month". The row with the latest start wins; a NULL amount means no
  budget. "This month only" writes one month; "this month onward" replaces the
  category's later settings and carries forward (spec section 3).

  Scenario: A one-off October row overrides an onward September row for October only
    Given an onward Dining budget of 500 from "2026-09"
    And a one-off Dining budget of 800 for "2026-10"
    Then the Dining budget for "2026-09" should be 500
    And the Dining budget for "2026-10" should be 800
    And the Dining budget for "2026-11" should be 500

  Scenario: A NULL amount means no budget from that month on
    Given an onward Dining budget of 500 from "2026-09"
    And Dining has no budget from "2026-11"
    Then the Dining budget for "2026-10" should be 500
    And the Dining budget for "2026-11" should be none
    And the Dining budget for "2026-12" should be none

  Scenario: Ties on the start month go to the latest written row
    Given an onward Dining budget of 500 from "2026-09"
    And a later onward Dining budget of 650 from "2026-09"
    Then the Dining budget for "2026-10" should be 650

  Scenario: An onward write from November deletes a December one-off
    Given an onward Dining budget of 500 from "2026-09"
    And a one-off Dining budget of 900 for "2026-12"
    When I set Dining to 700 onward from "2026-11"
    Then the Dining budget for "2026-10" should be 500
    And the Dining budget for "2026-11" should be 700
    And the Dining budget for "2026-12" should be 700

  Scenario: A one-off write leaves later months alone
    Given an onward Dining budget of 500 from "2026-09"
    When I set Dining to 900 for "2026-10" only
    Then the Dining budget for "2026-10" should be 900
    And the Dining budget for "2026-11" should be 500

  Scenario: Zero is Remove and is never stored as a budget
    Given an onward Dining budget of 500 from "2026-09"
    When I set Dining to 0 onward from "2026-11"
    Then the Dining budget for "2026-10" should be 500
    And the Dining budget for "2026-11" should be none
    And no stored row should hold an amount of 0
