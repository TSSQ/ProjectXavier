Feature: A tab reloads on focus only when something it shows has changed
  The Dashboard and Transactions tabs re-read the whole ledger on every
  focus (issue #27). They now reload only when the data revision, the
  currency or the day has moved since their last load.

  Scenario: The first focus always loads
    Given the data revision is 7 and the currency is "SGD"
    Then the first focus should reload

  Scenario: Nothing changed — no reload
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    Then the next focus should not reload

  Scenario: A write elsewhere bumps the revision — reload, once
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When the data revision becomes 8
    Then the next focus should reload
    And the focus after that should not reload

  Scenario: A currency change reloads though the revision didn't move
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When the currency becomes "USD"
    Then the next focus should reload

  Scenario: A failed load is retried on the next focus
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once but the load failed
    Then the next focus should reload

  Scenario: Midnight passes with no write — reload once for the new day
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When the day changes
    Then the next focus should reload
    And the focus after that should not reload
