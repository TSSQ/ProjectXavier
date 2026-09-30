Feature: Money and date formatters are built once, not per call
  formatMoney runs for every ledger row, header and dashboard figure, and
  used to build a new Intl.NumberFormat each time (issue #27).

  Scenario: The same locale and currency reuse one formatter
    When formatMoney runs 50 times for "SGD" in "en-US"
    Then only 1 NumberFormat should have been built

  Scenario: Different currencies or locales get their own formatter
    When formatMoney runs for "SGD" in "en-US", "JPY" in "en-US" and "SGD" in "en-GB"
    Then 3 NumberFormats should have been built

  Scenario: Output is unchanged
    Then formatting 123456 minor units of "SGD" should give "SGD 1,234.56"
    And formatting 1000 minor units of "JPY" should give "¥1,000"

  Scenario: A malformed currency still falls back, and isn't remembered
    Then formatting 1234 minor units of "bad!" should give "12.34" twice
    And formatting 1234 minor units of "USD" should give "$12.34"

  Scenario: Short dates keep their shape
    Then the short date for "2026-09-30T10:00:00" should be "Sep 30"
    And the month label for "2026-09-30T10:00:00" should be "September 2026"
