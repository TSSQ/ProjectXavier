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

  Scenario: Overlapping focuses are checked one at a time
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When three focuses start together while the revision changes between reads
    Then at most 1 read was ever in flight at once
    And each result matches the key its read actually saw
    And the next focus should not reload

  Scenario: A failed read doesn't block the next check
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When a focus starts whose read will fail
    And another focus starts right behind it
    Then the first focus should reject
    And the second focus should reload

  Scenario: The second read doesn't start until the first has finished
    Given the data revision is 7 and the currency is "SGD"
    And the screen has loaded once
    When two focuses start together with a reader that only resolves when told
    Then only the first read has started
    And resolving the first read lets the second one start
    And resolving the second read completes both checks
