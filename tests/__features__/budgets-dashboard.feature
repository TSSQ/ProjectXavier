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

  Scenario: With no budgets the current month offers setup and another month shows nothing
    Given a ledger with no budgets on October 18
    Then the card for the current month should be "setup"
    And the card for a past month should be "hidden"

  Scenario: An account filter changes neither the card nor its numbers
    Given the mockup fixture on October 18 spread over two accounts
    When I compute the budgets for the whole ledger
    And I compute the budgets for a ledger an account filter would show
    Then both summaries should be identical
    And the card kind should be the same for both
