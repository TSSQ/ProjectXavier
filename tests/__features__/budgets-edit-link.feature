Feature: The Transactions tab's edit deep link waits for a load that finished after it arrived
  Opening a just-logged transaction from budget category detail must not be
  consumed against a ledger that is older than the row (spec section 5.4).

  Scenario: A link to a row newer than the loaded ledger opens it after the focus refresh
    Given the tab holds a ledger loaded once without the row
    When the link arrives
    Then the decision should be "wait"
    When a refresh completes and the row is now in the ledger
    Then the decision should be "open"

  Scenario: A link to a deleted row is dropped after a refresh that still lacks it
    Given the tab holds a ledger loaded once without the row
    When the link arrives
    Then the decision should be "wait"
    When a refresh completes and the row is still absent
    Then the decision should be "drop"

  Scenario: A tap during an in-flight refresh that lacks the row waits for the next load and then opens
    Given the tab holds a ledger loaded once without the row
    And a refresh has started but not finished
    When the link arrives
    And that in-flight refresh completes without the row
    Then the decision should be "wait"
    When the next refresh starts, completes, and has the row
    Then the decision should be "open"

  Scenario: A row already in the ledger opens at once
    Given the tab holds a ledger loaded once with the row
    When the link arrives
    Then the decision should be "open"

  Scenario: The tx id is read from the token
    Then the id in "tx-42@1760000000000" should be "tx-42"
