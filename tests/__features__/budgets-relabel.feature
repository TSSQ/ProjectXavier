Feature: Currency relabel rescales budgets like every other stored amount
  Budgets are stored in the app currency's minor units, so a relabel that
  changes the exponent (SGD to JPY and back) must rescale them too, and a
  NULL amount ("no budget") must stay NULL.

  Scenario: SGD to JPY and back
    Given the store's currency is "SGD" with budgets of 60000, 30000 and none
    When I relabel the currency to "JPY"
    Then the budget amounts should be 600, 300 and none
    When I relabel the currency to "SGD"
    Then the budget amounts should be 60000, 30000 and none

  Scenario: Same-exponent relabel leaves budgets alone
    Given the store's currency is "USD" with budgets of 60000, 30000 and none
    When I relabel the currency to "SGD"
    Then the budget amounts should be 60000, 30000 and none

  Scenario: A budget that rounds to nothing becomes no budget, never 0
    Given the store's currency is "USD" with budgets of 40 and 6000
    When I relabel the currency to "JPY"
    Then the budget amounts should be none and 60
    And no stored budget should be 0 and every row should still read back
