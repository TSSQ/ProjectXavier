Feature: Copying a transaction (long-press "Copy")
  A copy is a fresh, standalone entry: dated today, tied to the original
  transaction's own account, never part of a recurring series, and never
  pending — regardless of which account "screen" it was long-pressed from or
  what state the original was in.

  Scenario: A copy is dated now, not the original's date
    Given a transaction that occurred on "2026-01-05"
    When I build the copy initial values as of "2026-02-10"
    Then the copy's date should be "2026-02-10"

  Scenario: The copy's account comes from the transaction, not the current screen
    Given a transaction in account "acc-savings"
    And the current screen is account "acc-checking"
    When I build the copy initial values
    Then the copy's account should be "acc-savings"

  Scenario: Copying a recurring occurrence produces a standalone entry
    Given a transaction that is occurrence "2026-01-05" of series "series-1"
    When I build the copy initial values
    Then the copy's repeat rule should be cleared
    And the copy's series id should be cleared
    And the copy's occurrence date should be cleared

  Scenario: Copying a pending transaction starts it counted
    Given a pending transaction
    When I build the copy initial values
    Then the copy should not be pending

  Scenario: Amount, type, note, and transfer destination are preserved
    Given a transfer transaction of 45.00 with note "Rent split" to account "acc-savings"
    When I build the copy initial values
    Then the copy's amount should be 45.00
    And the copy's type should be "transfer"
    And the copy's note should be "Rent split"
    And the copy's transfer account should be "acc-savings"

  Scenario Outline: The copy label falls back from payee to category to type
    Given a transaction of type "<type>" with payee "<payee>" and category "<category>"
    When I compute the copy label
    Then the copy label should be "<label>"

    Examples:
      | type     | payee  | category | label    |
      | expense  | Amazon | Shopping | Amazon   |
      | expense  |        | Shopping | Shopping |
      | expense  |        |          | Expense  |
      | income   |        |          | Income   |
      | transfer |        |          | Transfer |
