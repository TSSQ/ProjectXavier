Feature: The dashboard budget card shows for a single month only
  The card appears when the selected period is one month, is hidden for a year
  and for a custom range, and ignores the account filter entirely (spec
  sections 4.1 and 5.1).

  Scenario Outline: Visibility by period
    Given the mockup fixture on October 18
    When the period is <period> and I compute October
    Then the dashboard budget card should be <shown>

    Examples:
      | period | shown  |
      | month  | card   |
      | year   | hidden |
      | date   | hidden |

  Scenario: With no budgets the current month offers setup and any other month shows the empty card
    Given a ledger with no budgets on October 18
    Then the card for the current month should be "setup"
    And the card for a past month should be "empty"
    And the card for a future month should be "empty"
    And the year and date periods should stay "hidden" with no budgets

  Scenario: The empty card names the month, with the year when it is not this one
    Then the empty card for 2026-09 on October 18 should read "No budgets in September" and "Tap to add budgets for September"
    And the empty card for 2027-01 on October 18 should read "No budgets in January 2027" and "Tap to add budgets for January 2027"
    And the empty card for 2026-09 on October 18 should be labelled "No budgets in September. Open budget"
    And the empty card for 2026-12 on January 5 2027 should read "No budgets in December 2026" and "Tap to add budgets for December 2026"

  Scenario: An account filter changes neither the card nor its numbers
    Given the mockup fixture on October 18 spread over two accounts
    When I compute the budgets for the whole ledger
    And I compute the budgets for a ledger an account filter would show
    Then both summaries should be identical
    And the card kind should be the same for both
