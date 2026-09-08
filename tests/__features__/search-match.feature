Feature: Transaction search matching
  The Transactions screen searches two kinds of thing that look identical to
  a user: posted transactions, and the recurring series behind the "Upcoming"
  section. Build 109 filtered only the first, so searching "Cookie" hid every
  unrelated transaction but still listed every imminent recurring charge above
  them — the results read as if the search had half worked.

  A recurrence template carries the same searchable fields as the transaction
  it will eventually post, so both go through one predicate. These scenarios
  pin that they agree, which is the property that broke.

  Scenario: An empty query matches everything
    Given a transaction paid to "Cookie Run Crumble"
    Then a search for "" should match it
    And a search for "   " should match it

  Scenario: A query matches on the payee name, case-insensitively
    Given a transaction paid to "Cookie Run Crumble"
    Then a search for "cookie" should match it
    And a search for "CRUMBLE" should match it
    And a search for "Aviva" should not match it

  Scenario: A recurring template matches the same query as a transaction
    Given a transaction paid to "Cookie Run Crumble"
    And a recurring template paid to "Cookie Run Crumble"
    And a recurring template paid to "Aviva"
    Then a search for "cookie" should match both the transaction and its template
    And a search for "cookie" should not match the unrelated template

  Scenario: A query matches the fields a user can see
    Given a transaction paid to "Cookie Run Crumble"
    Then a search for "Game" should match it by category
    And a search for "UOB One" should match it by account
    And a search for "136.29" should match it by amount
    And a search for "receipt in the bag" should match it by note

  # The Upcoming strip is selected here rather than in the screen precisely
  # because the missing search filter was invisible to a predicate test: the
  # rule was right, the call was absent. These exercise the selection itself.
  Scenario: The Upcoming strip honours the search query
    Given a "Cookie Run Crumble" series due in 2 days
    And an "Aviva" series due in 3 days
    Then an empty search should list both
    And a search for "cookie" should list only the Cookie series

  Scenario: The Upcoming strip excludes what is not upcoming
    Given a "Cookie Run Crumble" series due in 2 days
    And a paused "Cookie Run Crumble" series due in 2 days
    And a "Cookie Run Crumble" series due in 30 days
    Then an empty search should list only the active, imminent one
